import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { DatabaseService } from '../database/database.service';
import { BusinessStatusDto } from './dto/business-status.dto';
import { RegisterBusinessDto } from './dto/register-business.dto';

type BusinessRow = {
  id: string;
  name: string;
  registration_number: string | null;
  contact_email: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
};

@Injectable()
export class BusinessesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async register(input: RegisterBusinessDto) {
    const passwordHash = await this.passwords.hash(input.password);
    let created: { business: BusinessRow; ownerId: string };
    try {
      created = await this.database.transaction(async (client) => {
        const owner = await client.query<{ id: string }>(
          `INSERT INTO users (email, phone, password_hash)
           VALUES (lower($1), $2, $3) RETURNING id`,
          [input.ownerEmail, input.ownerPhone ?? null, passwordHash],
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_code)
           VALUES ($1, 'BUSINESS_OWNER')`,
          [owner.rows[0].id],
        );
        const business = await client.query<BusinessRow>(
          `INSERT INTO businesses (
             name, registration_number, contact_email, status
           ) VALUES ($1, $2, lower($3), 'PENDING')
           RETURNING id, name, registration_number, contact_email, status,
                     created_at, updated_at`,
          [input.name, input.registrationNumber ?? null, input.ownerEmail],
        );
        await client.query(
          `INSERT INTO business_owners (business_id, user_id) VALUES ($1, $2)`,
          [business.rows[0].id, owner.rows[0].id],
        );
        await client.query(
          `INSERT INTO business_status_history (
             business_id, previous_status, next_status, changed_by
           ) VALUES ($1, NULL, 'PENDING', $2)`,
          [business.rows[0].id, owner.rows[0].id],
        );
        return { business: business.rows[0], ownerId: owner.rows[0].id };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Business registration already exists');
      }
      throw error;
    }
    await this.audit.record({
      actorUserId: created.ownerId,
      businessId: created.business.id,
      action: 'business.registered',
      targetType: 'business',
      targetId: created.business.id,
    });
    return this.present(created.business);
  }

  async list(principal: AuthenticatedPrincipal) {
    const crossTenant = principal.role === 'PLATFORM_SUPER_ADMIN';
    const result = await this.database.query<BusinessRow>(
      `SELECT id, name, registration_number, contact_email, status,
              created_at, updated_at
       FROM businesses
       WHERE $1::boolean OR id = ANY($2::uuid[])
       ORDER BY created_at DESC`,
      [crossTenant, principal.businessIds],
    );
    return result.rows.map((row) => this.present(row));
  }

  async changeStatus(
    businessId: string,
    input: BusinessStatusDto,
    actor: AuthenticatedPrincipal,
  ) {
    if (input.status === 'INACTIVE') {
      throw new BadRequestException(
        'INACTIVE is available only in the V2 business lifecycle',
      );
    }
    if (actor.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new ForbiddenException('Platform administrator access required');
    }
    const updated = await this.database.transaction(async (client) => {
      const current = await client.query<BusinessRow>(
        `SELECT id, name, registration_number, contact_email, status,
                created_at, updated_at
         FROM businesses WHERE id = $1 FOR UPDATE`,
        [businessId],
      );
      if (!current.rows[0]) throw new NotFoundException('Business not found');
      const next = await client.query<BusinessRow>(
        `UPDATE businesses SET status = $2, updated_at = now()
         WHERE id = $1
         RETURNING id, name, registration_number, contact_email, status,
                   created_at, updated_at`,
        [businessId, input.status],
      );
      await client.query(
        `INSERT INTO business_status_history (
           business_id, previous_status, next_status, reason, changed_by
         ) VALUES ($1, $2, $3, $4, $5)`,
        [
          businessId,
          current.rows[0].status,
          input.status,
          input.reason ?? null,
          actor.userId,
        ],
      );
      return next.rows[0];
    });
    await this.audit.record({
      actorUserId: actor.userId,
      businessId,
      action: `business.${input.status.toLowerCase()}`,
      targetType: 'business',
      targetId: businessId,
      metadata: { reason: input.reason },
    });
    return this.present(updated);
  }

  private present(row: BusinessRow) {
    return {
      id: row.id,
      name: row.name,
      registrationNumber: row.registration_number,
      contactEmail: row.contact_email,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
