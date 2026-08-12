import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PoolClient } from 'pg';
import { V2AuditService } from '../audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { PasswordService } from '../auth/password.service';
import { DatabaseService } from '../database/database.service';
import { BusinessStatusDto } from './dto/business-status.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';

type V2BusinessStatus =
  | 'REGISTRATION'
  | 'ACTIVE'
  | 'INACTIVE'
  | 'SUSPENDED'
  | 'CLOSED'
  | 'ARCHIVED';

type V2BusinessRow = {
  id: string;
  business_code: string;
  legal_name: string;
  category_id: string;
  category_name: string;
  custom_category: string | null;
  tin: string;
  phone: string;
  email: string | null;
  address: string;
  city: string;
  status: V2BusinessStatus;
  registration_at: Date;
  activation_at: Date | null;
  created_at: Date;
};

type RegistrationResult = {
  business: V2BusinessRow;
  ownerId: string;
  membershipId: string;
  membershipRoleId: string;
};

@Injectable()
export class V2BusinessesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly audit: V2AuditService,
  ) {}

  async register(input: RegisterBusinessDto) {
    const required = this.requireV2Registration(input);
    const passwordHash = await this.passwords.hash(input.password);
    let created: RegistrationResult;
    try {
      created = await this.database.transaction(async (client) => {
        const category = await client.query<{ is_other: boolean }>(
          `SELECT is_other FROM business_categories
           WHERE id = $1 AND is_active = true`,
          [required.categoryId],
        );
        if (!category.rows[0]) {
          throw new BadRequestException('Active business category not found');
        }
        if (category.rows[0].is_other && !input.customCategory) {
          throw new BadRequestException(
            'customCategory is required for the Other category',
          );
        }

        const owner = await client.query<{ id: string }>(
          `INSERT INTO users (
             full_name, phone_number, email, password_hash, global_status
           ) VALUES ($1, $2, lower($3), $4, 'ACTIVE')
           RETURNING id`,
          [
            required.ownerFullName,
            required.ownerPhone,
            input.ownerEmail,
            passwordHash,
          ],
        );
        const business = await client.query<V2BusinessRow>(
          `WITH inserted AS (
             INSERT INTO businesses (
               business_code, legal_name, category_id, custom_category,
               tin, phone, email, address, city, status
             ) VALUES ($1, $2, $3, $4, $5, $6, lower($7), $8, $9, 'REGISTRATION')
             RETURNING *
           )
           SELECT inserted.*, category.name AS category_name
           FROM inserted
           JOIN business_categories category ON category.id = inserted.category_id`,
          [
            required.businessCode,
            input.name,
            required.categoryId,
            input.customCategory ?? null,
            required.tin,
            required.businessPhone,
            input.ownerEmail,
            required.address,
            required.city,
          ],
        );
        const membership = await client.query<{ id: string }>(
          `INSERT INTO business_user_memberships (
             user_id, business_id, status
           ) VALUES ($1, $2, 'PENDING') RETURNING id`,
          [owner.rows[0].id, business.rows[0].id],
        );
        const role = await client.query<{ id: string }>(
          `INSERT INTO membership_role_assignments (
             membership_id, role_code, status
           ) VALUES ($1, 'PRIMARY_OWNER', 'PENDING') RETURNING id`,
          [membership.rows[0].id],
        );
        const result = {
          business: business.rows[0],
          ownerId: owner.rows[0].id,
          membershipId: membership.rows[0].id,
          membershipRoleId: role.rows[0].id,
        };
        await this.audit.recordWithClient(client, {
          actor: {
            identityType: 'BUSINESS_USER',
            subjectId: result.ownerId,
            role: 'PRIMARY_OWNER',
            businessId: result.business.id,
            membershipId: result.membershipId,
            membershipRoleId: result.membershipRoleId,
          },
          actionType: 'BUSINESS_REGISTERED',
          recordType: 'BUSINESS',
          recordId: result.business.id,
          businessId: result.business.id,
          newValue: { status: result.business.status },
        });
        return result;
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException(
          'Business code, TIN, owner email, or owner phone already exists',
        );
      }
      throw error;
    }

    return this.present(created.business);
  }

  async list(principal: AuthenticatedPrincipal) {
    const platformAdmin = principal.identityType === 'PLATFORM_ADMIN';
    const result = await this.database.query<V2BusinessRow>(
      `SELECT business.*, category.name AS category_name
       FROM businesses business
       JOIN business_categories category ON category.id = business.category_id
       WHERE $1::boolean OR business.id = ANY($2::uuid[])
       ORDER BY business.created_at DESC`,
      [platformAdmin, principal.businessIds],
    );
    return result.rows.map((row) => this.present(row));
  }

  async changeStatus(
    businessId: string,
    input: BusinessStatusDto,
    actor: AuthenticatedPrincipal,
  ) {
    const nextStatus = input.status;
    if (
      actor.identityType !== 'PLATFORM_ADMIN' ||
      actor.role !== 'PLATFORM_SUPER_ADMIN'
    ) {
      throw new ForbiddenException('Platform administrator access required');
    }
    if (nextStatus === 'REJECTED') {
      throw new BadRequestException(
        'REJECTED is not part of the V2 business lifecycle',
      );
    }

    const updated = await this.database.transaction(async (client) => {
      const current = await this.findRow(client, businessId, true);
      this.assertTransition(current.status, nextStatus);
      const result = await client.query<V2BusinessRow>(
        `WITH changed AS (
           UPDATE businesses
           SET status = $2::varchar,
               activation_at = CASE
                 WHEN $2::varchar = 'ACTIVE' AND activation_at IS NULL THEN now()
                 ELSE activation_at
               END,
               last_activity_at = now()
           WHERE id = $1
           RETURNING *
         )
         SELECT changed.*, category.name AS category_name
         FROM changed
         JOIN business_categories category ON category.id = changed.category_id`,
        [businessId, nextStatus],
      );
      if (current.status === 'REGISTRATION' && nextStatus === 'ACTIVE') {
        await this.activatePrimaryOwner(client, businessId);
      }
      await this.audit.recordWithClient(client, {
        actor: this.adminContext(actor),
        sessionId: actor.sessionId,
        actionType: 'BUSINESS_STATUS_CHANGED',
        recordType: 'BUSINESS',
        recordId: businessId,
        businessId,
        previousValue: { status: current.status },
        newValue: { status: result.rows[0].status },
        reason: input.reason,
      });
      return { previous: current, next: result.rows[0] };
    });
    return this.present(updated.next);
  }

  private requireV2Registration(input: RegisterBusinessDto) {
    const required = {
      businessCode: input.businessCode?.trim(),
      categoryId: input.categoryId,
      tin: (input.tin ?? input.registrationNumber)?.trim(),
      businessPhone: input.businessPhone?.trim(),
      address: input.address?.trim(),
      city: input.city?.trim(),
      ownerFullName: input.ownerFullName?.trim(),
      ownerPhone: input.ownerPhone?.trim(),
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) {
      throw new BadRequestException(
        `V2 registration requires: ${missing.join(', ')}`,
      );
    }
    return required as { [K in keyof typeof required]: string };
  }

  private assertTransition(
    previous: V2BusinessStatus,
    next: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED',
  ): void {
    const allowed: Record<V2BusinessStatus, V2BusinessStatus[]> = {
      REGISTRATION: ['ACTIVE', 'INACTIVE'],
      ACTIVE: ['INACTIVE', 'SUSPENDED'],
      INACTIVE: ['ACTIVE', 'SUSPENDED'],
      SUSPENDED: ['ACTIVE', 'INACTIVE'],
      CLOSED: [],
      ARCHIVED: [],
    };
    if (previous === next || !allowed[previous].includes(next)) {
      throw new BadRequestException(
        `Business status cannot change from ${previous} to ${next}`,
      );
    }
  }

  private async activatePrimaryOwner(
    client: PoolClient,
    businessId: string,
  ): Promise<void> {
    const membership = await client.query<{ id: string }>(
      `UPDATE business_user_memberships membership
       SET status = 'ACTIVE', joined_at = COALESCE(joined_at, now()),
           approved_at = COALESCE(approved_at, now()), updated_at = now()
       WHERE membership.business_id = $1
         AND membership.status = 'PENDING'
         AND EXISTS (
           SELECT 1 FROM membership_role_assignments role_assignment
           WHERE role_assignment.membership_id = membership.id
             AND role_assignment.role_code = 'PRIMARY_OWNER'
             AND role_assignment.status = 'PENDING'
         )
       RETURNING id`,
      [businessId],
    );
    if (membership.rowCount !== 1) {
      throw new ConflictException('Pending Primary Owner membership not found');
    }
    await client.query(
      `UPDATE membership_role_assignments
       SET status = 'ACTIVE', approved_at = COALESCE(approved_at, now()),
           assigned_at = COALESCE(assigned_at, now())
       WHERE membership_id = $1
         AND role_code = 'PRIMARY_OWNER'
         AND status = 'PENDING'`,
      [membership.rows[0].id],
    );
  }

  private async findRow(
    client: PoolClient,
    businessId: string,
    lock = false,
  ): Promise<V2BusinessRow> {
    const result = await client.query<V2BusinessRow>(
      `SELECT business.*, category.name AS category_name
       FROM businesses business
       JOIN business_categories category ON category.id = business.category_id
       WHERE business.id = $1 ${lock ? 'FOR UPDATE OF business' : ''}`,
      [businessId],
    );
    if (!result.rows[0]) throw new NotFoundException('Business not found');
    return result.rows[0];
  }

  private adminContext(actor: AuthenticatedPrincipal): V2SelectedAuthContext {
    return {
      identityType: 'PLATFORM_ADMIN',
      subjectId: actor.userId,
      role: 'PLATFORM_SUPER_ADMIN',
    };
  }

  private present(row: V2BusinessRow) {
    return {
      id: row.id,
      businessCode: row.business_code,
      name: row.legal_name,
      category: {
        id: row.category_id,
        name: row.category_name,
        customName: row.custom_category,
      },
      tin: row.tin,
      phone: row.phone,
      contactEmail: row.email,
      address: row.address,
      city: row.city,
      status: row.status,
      registrationAt: row.registration_at,
      activationAt: row.activation_at,
      createdAt: row.created_at,
    };
  }
}
