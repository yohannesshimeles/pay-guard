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
import { CreateStaffDto, RemoveStaffDto } from './dto/staff.dto';

type V2StaffRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone_number: string;
  global_status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
  membership_id: string;
  membership_status: string;
  membership_role_id: string;
  role_code: 'MANAGER' | 'CASHIER' | 'WAITER';
  role_status: string;
  work_assignment_id: string;
  assignment_status: string;
  branch_id: string;
  assigned_at: Date | null;
  removed_at: Date | null;
  removal_reason: string | null;
  created_at: Date;
};

@Injectable()
export class V2UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly audit: V2AuditService,
  ) {}

  async createStaff(
    businessId: string,
    branchId: string,
    input: CreateStaffDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerOrAdmin(actor, businessId);
    const fullName = input.fullName?.trim();
    const phone = input.phone?.trim();
    if (!fullName || !phone) {
      throw new BadRequestException(
        'V2 staff creation requires: fullName, phone',
      );
    }
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    try {
      const row = await this.database.transaction(async (client) => {
        await this.requireAssignableBranch(client, businessId, branchId, true);
        const approver = await this.resolveApprover(client, actor, businessId);
        const user = await client.query<{ id: string }>(
          `INSERT INTO users (
             full_name, phone_number, email, password_hash, address, gender,
             global_status
           ) VALUES ($1, $2, lower($3), $4, $5, $6, 'ACTIVE')
           RETURNING id`,
          [
            fullName,
            phone,
            input.email,
            passwordHash,
            input.address ?? null,
            input.gender ?? null,
          ],
        );
        const membership = await client.query<{ id: string }>(
          `INSERT INTO business_user_memberships (
             user_id, business_id, status, joined_at,
             approved_by_membership_id, approved_at
           ) VALUES ($1, $2, 'ACTIVE', now(), $3, now())
           RETURNING id`,
          [user.rows[0].id, businessId, approver.membershipId],
        );
        const role = await client.query<{ id: string }>(
          `INSERT INTO membership_role_assignments (
             membership_id, role_code, status,
             approved_by_role_assignment_id, approved_at, assigned_at
           ) VALUES ($1, $2, 'ACTIVE', $3, now(), now())
           RETURNING id`,
          [membership.rows[0].id, input.role, approver.membershipRoleId],
        );
        const assignment = await client.query<{ id: string }>(
          `INSERT INTO user_work_assignments (
             membership_role_id, business_id, assignment_type, branch_id,
             status, is_primary_context, approved_by_role_assignment_id,
             approved_at, assigned_at
           ) VALUES (
             $1, $2, 'BRANCH', $3, 'ACTIVE', true, $4, now(), now()
           ) RETURNING id`,
          [role.rows[0].id, businessId, branchId, approver.membershipRoleId],
        );
        const created = await this.findStaff(
          client,
          businessId,
          branchId,
          user.rows[0].id,
          assignment.rows[0].id,
          true,
        );
        await this.audit.recordWithClient(client, {
          actor: this.auditContext(actor),
          sessionId: actor.sessionId,
          actionType: 'STAFF_CREATED',
          recordType: 'USER',
          recordId: created.id,
          businessId,
          branchId,
          newValue: {
            role: created.role_code,
            membershipId: created.membership_id,
            workAssignmentId: created.work_assignment_id,
          },
        });
        return created;
      });
      return this.present(row, false);
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Staff email or phone already exists');
      }
      throw error;
    }
  }

  async list(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
    includeRemoved = false,
  ) {
    this.assertOwnerOrAdmin(actor, businessId);
    await this.requireAssignableBranch(undefined, businessId, branchId, false);
    const result = await this.database.query<V2StaffRow>(
      `${this.staffSelect()}
       WHERE membership.business_id = $1
         AND assignment.branch_id = $2
         AND assignment.assignment_type = 'BRANCH'
         AND role_assignment.role_code IN ('MANAGER','CASHIER','WAITER')
         AND ($3::boolean OR assignment.status <> 'REMOVED')
       ORDER BY app_user.created_at, assignment.created_at`,
      [businessId, branchId, includeRemoved],
    );
    return result.rows.map((row) => this.present(row, includeRemoved));
  }

  async remove(
    businessId: string,
    branchId: string,
    userId: string,
    input: RemoveStaffDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerOrAdmin(actor, businessId);
    const removed = await this.database.transaction(async (client) => {
      await this.requireAssignableBranch(client, businessId, branchId, true);
      const staff = await this.findStaff(
        client,
        businessId,
        branchId,
        userId,
        undefined,
        true,
      );
      if (staff.assignment_status === 'REMOVED') {
        throw new ConflictException('Staff assignment is already removed');
      }
      if (staff.role_code === 'MANAGER') {
        const managers = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM user_work_assignments assignment
           JOIN membership_role_assignments role_assignment
             ON role_assignment.id = assignment.membership_role_id
           JOIN business_user_memberships membership
             ON membership.id = role_assignment.membership_id
           WHERE assignment.business_id = $1
             AND assignment.branch_id = $2
             AND assignment.status = 'ACTIVE'
             AND role_assignment.status = 'ACTIVE'
             AND membership.status = 'ACTIVE'
             AND role_assignment.role_code = 'MANAGER'`,
          [businessId, branchId],
        );
        if (Number(managers.rows[0].count) <= 1) {
          throw new ConflictException(
            'The final active Manager cannot be removed from a branch',
          );
        }
      }

      await client.query(
        `UPDATE user_work_assignments
         SET status = 'REMOVED', removed_at = now(), removal_reason = $2
         WHERE id = $1 AND status = 'ACTIVE'`,
        [staff.work_assignment_id, input.reason],
      );
      await client.query(
        `UPDATE user_sessions
         SET session_status = 'REVOKED', revoked_at = now(),
             revoked_reason = 'Staff branch assignment removed'
         WHERE work_assignment_id = $1 AND session_status = 'ACTIVE'`,
        [staff.work_assignment_id],
      );
      await client.query(
        `UPDATE membership_role_assignments role_assignment
         SET status = 'REMOVED', removed_at = now(), removal_reason = $2,
             removed_by_role_assignment_id = $3
         WHERE role_assignment.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM user_work_assignments assignment
             WHERE assignment.membership_role_id = role_assignment.id
               AND assignment.status = 'ACTIVE'
           )`,
        [staff.membership_role_id, input.reason, actor.membershipRoleId ?? null],
      );
      await client.query(
        `UPDATE business_user_memberships membership
         SET status = 'REMOVED', removed_at = now(), removal_reason = $2,
             removed_by_membership_id = $3
         WHERE membership.id = $1
           AND NOT EXISTS (
             SELECT 1 FROM membership_role_assignments role_assignment
             WHERE role_assignment.membership_id = membership.id
               AND role_assignment.status = 'ACTIVE'
           )`,
        [staff.membership_id, input.reason, actor.membershipId ?? null],
      );
      await this.audit.recordWithClient(client, {
        actor: this.auditContext(actor),
        sessionId: actor.sessionId,
        actionType: 'STAFF_REMOVED',
        recordType: 'USER',
        recordId: userId,
        businessId,
        branchId,
        previousValue: {
          role: staff.role_code,
          assignmentStatus: staff.assignment_status,
        },
        newValue: { assignmentStatus: 'REMOVED' },
        reason: input.reason,
      });
      return staff;
    });
    return {
      id: removed.id,
      businessId,
      branchId,
      status: 'REMOVED',
    };
  }

  private assertOwnerOrAdmin(
    actor: AuthenticatedPrincipal,
    businessId: string,
  ): void {
    if (actor.identityType === 'PLATFORM_ADMIN') return;
    if (
      (actor.role !== 'PRIMARY_OWNER' && actor.role !== 'ADDITIONAL_OWNER') ||
      !actor.businessIds.includes(businessId) ||
      !actor.membershipId ||
      !actor.membershipRoleId
    ) {
      throw new ForbiddenException('Business Owner access required');
    }
  }

  private async resolveApprover(
    client: PoolClient,
    actor: AuthenticatedPrincipal,
    businessId: string,
  ): Promise<{ membershipId: string | null; membershipRoleId: string | null }> {
    if (actor.identityType === 'PLATFORM_ADMIN') {
      return { membershipId: null, membershipRoleId: null };
    }
    const result = await client.query(
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
      [businessId, actor.membershipId, actor.membershipRoleId, actor.userId],
    );
    if (!result.rowCount) throw new ForbiddenException('Active Owner required');
    return {
      membershipId: actor.membershipId!,
      membershipRoleId: actor.membershipRoleId!,
    };
  }

  private async requireAssignableBranch(
    client: PoolClient | undefined,
    businessId: string,
    branchId: string,
    lock: boolean,
  ): Promise<void> {
    const result = client
      ? await client.query(
          `SELECT 1
           FROM branches branch
           JOIN businesses business ON business.id = branch.business_id
           WHERE branch.id = $2
             AND branch.business_id = $1
             AND business.status = 'ACTIVE'
             AND branch.status IN ('SETUP_REQUIRED','READY','ACTIVE')
           ${lock ? 'FOR UPDATE OF branch' : ''}`,
          [businessId, branchId],
        )
      : await this.database.query(
      `SELECT 1
       FROM branches branch
       JOIN businesses business ON business.id = branch.business_id
       WHERE branch.id = $2
         AND branch.business_id = $1
         AND business.status = 'ACTIVE'
         AND branch.status IN ('SETUP_REQUIRED','READY','ACTIVE')
       ${lock ? 'FOR UPDATE OF branch' : ''}`,
      [businessId, branchId],
    );
    if (!result.rowCount) {
      throw new NotFoundException('Assignable branch not found');
    }
  }

  private async findStaff(
    client: PoolClient,
    businessId: string,
    branchId: string,
    userId: string,
    workAssignmentId: string | undefined,
    includeRemoved: boolean,
  ): Promise<V2StaffRow> {
    const result = await client.query<V2StaffRow>(
      `${this.staffSelect()}
       WHERE app_user.id = $3
         AND membership.business_id = $1
         AND assignment.branch_id = $2
         AND assignment.assignment_type = 'BRANCH'
         AND ($4::uuid IS NULL OR assignment.id = $4::uuid)
         AND ($5::boolean OR assignment.status <> 'REMOVED')
       ORDER BY assignment.created_at DESC
       LIMIT 1
       FOR UPDATE OF assignment`,
      [businessId, branchId, userId, workAssignmentId ?? null, includeRemoved],
    );
    if (!result.rows[0]) throw new NotFoundException('Staff user not found');
    return result.rows[0];
  }

  private staffSelect(): string {
    return `SELECT app_user.id, app_user.full_name, app_user.email,
                   app_user.phone_number, app_user.global_status,
                   membership.id AS membership_id,
                   membership.status AS membership_status,
                   role_assignment.id AS membership_role_id,
                   role_assignment.role_code, role_assignment.status AS role_status,
                   assignment.id AS work_assignment_id,
                   assignment.status AS assignment_status,
                   assignment.branch_id, assignment.assigned_at,
                   assignment.removed_at, assignment.removal_reason,
                   app_user.created_at
            FROM users app_user
            JOIN business_user_memberships membership
              ON membership.user_id = app_user.id
            JOIN membership_role_assignments role_assignment
              ON role_assignment.membership_id = membership.id
            JOIN user_work_assignments assignment
              ON assignment.membership_role_id = role_assignment.id`;
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

  private present(row: V2StaffRow, includeRemoval: boolean) {
    return {
      id: row.id,
      fullName: row.full_name,
      email: row.email,
      phone: row.phone_number,
      globalStatus: row.global_status,
      membershipId: row.membership_id,
      membershipStatus: row.membership_status,
      membershipRoleId: row.membership_role_id,
      role: row.role_code,
      roleStatus: row.role_status,
      workAssignmentId: row.work_assignment_id,
      assignmentStatus: row.assignment_status,
      branchId: row.branch_id,
      assignedAt: row.assigned_at,
      createdAt: row.created_at,
      ...(includeRemoval
        ? { removedAt: row.removed_at, removalReason: row.removal_reason }
        : {}),
    };
  }
}
