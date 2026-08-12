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
import { DatabaseService } from '../database/database.service';
import { CreateBranchDto, UpdateBranchDto } from './dto/branch.dto';

type V2BranchRow = {
  id: string;
  branch_code: string;
  business_id: string;
  branch_name: string;
  address: string;
  city: string;
  sub_city: string;
  woreda: string;
  location_details: string;
  settlement_mode: 'MAIN_BUSINESS_ALL' | 'BRANCH_SPECIFIC';
  status:
    | 'SETUP_REQUIRED'
    | 'READY'
    | 'ACTIVE'
    | 'INACTIVE'
    | 'SUSPENDED'
    | 'CLOSED'
    | 'ARCHIVED';
  created_by_membership_id: string;
  created_at: Date;
  activated_at: Date | null;
};

@Injectable()
export class V2BranchesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly audit: V2AuditService,
  ) {}

  async create(
    businessId: string,
    input: CreateBranchDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertBusinessAccess(actor, businessId);
    const required = this.requireCreateFields(input);
    const context = this.requireOwnerContext(actor, businessId);

    try {
      const row = await this.database.transaction(async (client) => {
        await this.requireActiveBusiness(client, businessId, true);
        const membership = await client.query(
          `SELECT 1
           FROM business_user_memberships membership
           JOIN membership_role_assignments role_assignment
             ON role_assignment.id = $3
            AND role_assignment.membership_id = membership.id
           WHERE membership.id = $2
             AND membership.business_id = $1
             AND membership.user_id = $4
             AND membership.status = 'ACTIVE'
             AND role_assignment.status = 'ACTIVE'
             AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER')`,
          [businessId, context.membershipId, context.membershipRoleId, actor.userId],
        );
        if (!membership.rowCount) {
          throw new ForbiddenException('Active Owner membership required');
        }

        const inserted = await client.query<V2BranchRow>(
          `INSERT INTO branches (
             branch_code, business_id, branch_name, address, city, sub_city,
             woreda, location_details, settlement_mode,
             created_by_membership_id
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           RETURNING *`,
          [
            required.code,
            businessId,
            input.name,
            required.address,
            required.city,
            required.subCity,
            required.woreda,
            required.locationDetails,
            input.settlementMode ?? 'MAIN_BUSINESS_ALL',
            context.membershipId,
          ],
        );
        await this.audit.recordWithClient(client, {
          actor: context,
          sessionId: actor.sessionId,
          actionType: 'BRANCH_CREATED',
          recordType: 'BRANCH',
          recordId: inserted.rows[0].id,
          businessId,
          branchId: inserted.rows[0].id,
          newValue: {
            branchCode: inserted.rows[0].branch_code,
            status: inserted.rows[0].status,
          },
        });
        return inserted.rows[0];
      });
      return this.present(row);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Branch code already exists');
      }
      throw error;
    }
  }

  async list(businessId: string, actor: AuthenticatedPrincipal) {
    this.assertBusinessAccess(actor, businessId);
    const restrictToBranch = !this.canViewAllBranches(actor);
    if (restrictToBranch && !actor.branchId) {
      throw new ForbiddenException('An active branch context is required');
    }
    const result = await this.database.query<V2BranchRow>(
      `SELECT * FROM branches
       WHERE business_id = $1
         AND ($2::uuid IS NULL OR id = $2::uuid)
       ORDER BY created_at`,
      [businessId, restrictToBranch ? actor.branchId : null],
    );
    return result.rows.map((row) => this.present(row));
  }

  async update(
    businessId: string,
    branchId: string,
    input: UpdateBranchDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertBusinessAccess(actor, businessId);
    this.assertOwnerOrAdmin(actor);
    if (input.verificationTimeToleranceMinutes !== undefined) {
      throw new BadRequestException(
        'verificationTimeToleranceMinutes is not part of the V2 branch schema',
      );
    }
    const row = await this.database.transaction(async (client) => {
      await this.requireActiveBusiness(client, businessId, false);
      const current = await this.findRow(client, businessId, branchId, true);
      const updated = await client.query<V2BranchRow>(
        `UPDATE branches
         SET branch_name = COALESCE($3, branch_name),
             address = COALESCE($4, address),
             city = COALESCE($5, city),
             sub_city = COALESCE($6, sub_city),
             woreda = COALESCE($7, woreda),
             location_details = COALESCE($8, location_details),
             settlement_mode = COALESCE($9, settlement_mode),
             last_activity_at = now()
         WHERE id = $1 AND business_id = $2
         RETURNING *`,
        [
          branchId,
          businessId,
          input.name ?? null,
          input.address ?? null,
          input.city ?? null,
          input.subCity ?? null,
          input.woreda ?? null,
          input.locationDetails ?? null,
          input.settlementMode ?? null,
        ],
      );
      await this.audit.recordWithClient(client, {
        actor: this.auditContext(actor),
        sessionId: actor.sessionId,
        actionType: 'BRANCH_UPDATED',
        recordType: 'BRANCH',
        recordId: branchId,
        businessId,
        branchId,
        previousValue: this.auditValue(current),
        newValue: this.auditValue(updated.rows[0]),
      });
      return updated.rows[0];
    });
    return this.present(row);
  }

  private requireCreateFields(input: CreateBranchDto) {
    const required = {
      code: input.code?.trim(),
      address: input.address?.trim(),
      city: input.city?.trim(),
      subCity: input.subCity?.trim(),
      woreda: input.woreda?.trim(),
      locationDetails: input.locationDetails?.trim(),
    };
    const missing = Object.entries(required)
      .filter(([, value]) => !value)
      .map(([key]) => key);
    if (missing.length) {
      throw new BadRequestException(
        `V2 branch creation requires: ${missing.join(', ')}`,
      );
    }
    return required as { [K in keyof typeof required]: string };
  }

  private assertBusinessAccess(actor: AuthenticatedPrincipal, businessId: string) {
    if (
      actor.identityType !== 'PLATFORM_ADMIN' &&
      !actor.businessIds.includes(businessId)
    ) {
      throw new ForbiddenException('Business access denied');
    }
  }

  private assertOwnerOrAdmin(actor: AuthenticatedPrincipal): void {
    if (
      actor.identityType !== 'PLATFORM_ADMIN' &&
      actor.role !== 'PRIMARY_OWNER' &&
      actor.role !== 'ADDITIONAL_OWNER'
    ) {
      throw new ForbiddenException('Owner or Platform Admin access required');
    }
  }

  private requireOwnerContext(
    actor: AuthenticatedPrincipal,
    businessId: string,
  ): V2SelectedAuthContext {
    if (
      actor.identityType !== 'BUSINESS_USER' ||
      (actor.role !== 'PRIMARY_OWNER' && actor.role !== 'ADDITIONAL_OWNER') ||
      !actor.membershipId ||
      !actor.membershipRoleId ||
      !actor.businessIds.includes(businessId)
    ) {
      throw new ForbiddenException('Active Owner context required');
    }
    return this.auditContext(actor);
  }

  private canViewAllBranches(actor: AuthenticatedPrincipal): boolean {
    return (
      actor.identityType === 'PLATFORM_ADMIN' ||
      actor.role === 'PRIMARY_OWNER' ||
      actor.role === 'ADDITIONAL_OWNER'
    );
  }

  private async requireActiveBusiness(
    client: PoolClient,
    businessId: string,
    lock: boolean,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1 FROM businesses
       WHERE id = $1 AND status = 'ACTIVE'
       ${lock ? 'FOR UPDATE' : ''}`,
      [businessId],
    );
    if (!result.rowCount) throw new NotFoundException('Active business not found');
  }

  private async findRow(
    client: PoolClient,
    businessId: string,
    branchId: string,
    lock: boolean,
  ): Promise<V2BranchRow> {
    const result = await client.query<V2BranchRow>(
      `SELECT * FROM branches
       WHERE id = $2 AND business_id = $1
       ${lock ? 'FOR UPDATE' : ''}`,
      [businessId, branchId],
    );
    if (!result.rows[0]) throw new NotFoundException('Branch not found');
    return result.rows[0];
  }

  private auditContext(actor: AuthenticatedPrincipal): V2SelectedAuthContext {
    return {
      identityType: actor.identityType ?? 'BUSINESS_USER',
      subjectId: actor.userId,
      role: actor.role as V2SelectedAuthContext['role'],
      businessId: actor.businessIds[0],
      membershipId: actor.membershipId,
      membershipRoleId: actor.membershipRoleId,
      workAssignmentId: actor.workAssignmentId,
      branchId: actor.branchId,
    };
  }

  private auditValue(row: V2BranchRow): Record<string, unknown> {
    return {
      name: row.branch_name,
      address: row.address,
      city: row.city,
      subCity: row.sub_city,
      woreda: row.woreda,
      locationDetails: row.location_details,
      settlementMode: row.settlement_mode,
    };
  }

  private present(row: V2BranchRow) {
    return {
      id: row.id,
      businessId: row.business_id,
      code: row.branch_code,
      name: row.branch_name,
      address: row.address,
      city: row.city,
      subCity: row.sub_city,
      woreda: row.woreda,
      locationDetails: row.location_details,
      settlementMode: row.settlement_mode,
      status: row.status,
      createdByMembershipId: row.created_by_membership_id,
      activatedAt: row.activated_at,
      createdAt: row.created_at,
    };
  }
}
