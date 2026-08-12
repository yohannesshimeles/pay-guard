import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedPrincipal, RoleCode } from '../auth/auth.types';
import { PasswordService } from '../auth/password.service';
import { DatabaseService } from '../database/database.service';
import { CreateStaffDto, RemoveStaffDto } from './dto/staff.dto';

type StaffRow = {
  id: string;
  email: string | null;
  phone: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'REMOVED';
  role_code: RoleCode;
  branch_id: string;
  created_at: Date;
  removed_at: Date | null;
  removal_reason: string | null;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly database: DatabaseService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
  ) {}

  async createStaff(
    businessId: string,
    branchId: string,
    input: CreateStaffDto,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertOwnerAccess(actor, businessId);
    const passwordHash = await this.passwords.hash(input.temporaryPassword);
    let row: StaffRow;
    try {
      row = await this.database.transaction(async (client) => {
        await this.requireBranch(client, businessId, branchId);
        const user = await client.query<{ id: string }>(
          `INSERT INTO users (email, phone, password_hash)
           VALUES (lower($1), $2, $3) RETURNING id`,
          [input.email, input.phone ?? null, passwordHash],
        );
        await client.query(
          `INSERT INTO user_roles (user_id, role_code) VALUES ($1, $2)`,
          [user.rows[0].id, input.role],
        );
        await client.query(
          `INSERT INTO branch_user_assignments (branch_id, user_id, role_code)
           VALUES ($1, $2, $3)`,
          [branchId, user.rows[0].id, input.role],
        );
        return this.findStaff(client, branchId, user.rows[0].id, true);
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new ConflictException('Staff identity or assignment already exists');
      }
      throw error;
    }
    await this.audit.record({
      actorUserId: actor.userId,
      businessId,
      branchId,
      action: 'staff.created',
      targetType: 'user',
      targetId: row.id,
      metadata: { role: row.role_code },
    });
    return this.present(row, false);
  }

  async list(
    businessId: string,
    branchId: string,
    actor: AuthenticatedPrincipal,
    includeRemoved = false,
  ) {
    this.assertOwnerAccess(actor, businessId);
    const branch = await this.database.query(
      `SELECT 1 FROM branches WHERE id = $1 AND business_id = $2`,
      [branchId, businessId],
    );
    if (!branch.rowCount) throw new NotFoundException('Branch not found');
    const result = await this.database.query<StaffRow>(
      `SELECT u.id, u.email, u.phone, u.status, ur.role_code,
              bua.branch_id, u.created_at, u.removed_at, u.removal_reason
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN branch_user_assignments bua ON bua.user_id = u.id
       WHERE bua.branch_id = $1
         AND ($2::boolean OR u.status <> 'REMOVED')
       ORDER BY u.created_at`,
      [branchId, includeRemoved],
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
    this.assertOwnerAccess(actor, businessId);
    const previous = await this.database.transaction(async (client) => {
      await this.requireBranch(client, businessId, branchId);
      const staff = await this.findStaff(client, branchId, userId, true);
      if (staff.status === 'REMOVED') {
        throw new ConflictException('Staff user is already removed');
      }
      if (staff.role_code === 'MANAGER') {
        const managers = await client.query<{ count: string }>(
          `SELECT count(*)::text AS count
           FROM branch_user_assignments bua
           JOIN users u ON u.id = bua.user_id
           WHERE bua.branch_id = $1
             AND bua.role_code = 'MANAGER'
             AND bua.active = true
             AND u.status = 'ACTIVE'`,
          [branchId],
        );
        if (Number(managers.rows[0].count) <= 1) {
          throw new ConflictException(
            'The final active Manager cannot be removed from a branch',
          );
        }
      }
      await client.query(
        `UPDATE users
         SET status = 'REMOVED', removed_at = now(),
             removal_reason = $2, removed_by = $3, updated_at = now()
         WHERE id = $1`,
        [userId, input.reason, actor.userId],
      );
      await client.query(
        `UPDATE branch_user_assignments SET active = false
         WHERE user_id = $1 AND branch_id = $2`,
        [userId, branchId],
      );
      await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [userId],
      );
      await client.query(
        `UPDATE devices SET active = false
         WHERE user_id = $1 AND active = true`,
        [userId],
      );
      return staff;
    });
    await this.audit.record({
      actorUserId: actor.userId,
      businessId,
      branchId,
      action: 'staff.removed',
      targetType: 'user',
      targetId: userId,
      metadata: { reason: input.reason, previousStatus: previous.status },
    });
    return { id: userId, status: 'REMOVED' };
  }

  private assertOwnerAccess(actor: AuthenticatedPrincipal, businessId: string) {
    if (
      actor.role !== 'PLATFORM_SUPER_ADMIN' &&
      (actor.role !== 'BUSINESS_OWNER' ||
        !actor.businessIds.includes(businessId))
    ) {
      throw new ForbiddenException('Business Owner access required');
    }
  }

  private async requireBranch(
    client: { query(text: string, values?: unknown[]): Promise<{ rowCount: number | null }> },
    businessId: string,
    branchId: string,
  ) {
    const result = await client.query(
      `SELECT 1 FROM branches
       WHERE id = $1 AND business_id = $2 AND status = 'ACTIVE'`,
      [branchId, businessId],
    );
    if (!result.rowCount) throw new NotFoundException('Active branch not found');
  }

  private async findStaff(
    client: { query<T>(text: string, values?: unknown[]): Promise<{ rows: T[] }> },
    branchId: string,
    userId: string,
    includeRemoved: boolean,
  ): Promise<StaffRow> {
    const result = await client.query<StaffRow>(
      `SELECT u.id, u.email, u.phone, u.status, ur.role_code,
              bua.branch_id, u.created_at, u.removed_at, u.removal_reason
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       JOIN branch_user_assignments bua ON bua.user_id = u.id
       WHERE u.id = $2 AND bua.branch_id = $1
         AND ($3::boolean OR u.status <> 'REMOVED')
       FOR UPDATE OF u`,
      [branchId, userId, includeRemoved],
    );
    if (!result.rows[0]) throw new NotFoundException('Staff user not found');
    return result.rows[0];
  }

  private present(row: StaffRow, includeRemoval: boolean) {
    return {
      id: row.id,
      email: row.email,
      phone: row.phone,
      status: row.status,
      role: row.role_code,
      branchId: row.branch_id,
      createdAt: row.created_at,
      ...(includeRemoval
        ? { removedAt: row.removed_at, removalReason: row.removal_reason }
        : {}),
    };
  }
}
