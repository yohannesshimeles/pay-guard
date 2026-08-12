import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import {
  V2AuthIdentity,
  V2AuthorizationContext,
  V2RoleCode,
  V2WorkScope,
} from './v2-auth.types';

type PlatformAdminRow = {
  id: string;
  password_hash: string;
  status: 'ACTIVE';
};

type BusinessUserRow = {
  id: string;
  password_hash: string;
  global_status: 'ACTIVE' | 'SUSPENDED' | 'REMOVED';
};

type AuthorizationContextRow = {
  membership_id: string;
  membership_role_id: string;
  role_code: Exclude<V2RoleCode, 'PLATFORM_SUPER_ADMIN'>;
  business_id: string;
  work_assignment_id: string | null;
  assignment_type: V2WorkScope | null;
  branch_id: string | null;
};

@Injectable()
export class V2AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async findIdentity(identity: string): Promise<V2AuthIdentity | undefined> {
    const normalizedIdentity = identity.trim();
    const platformAdmin = await this.findPlatformAdmin(normalizedIdentity);
    if (platformAdmin) return platformAdmin;

    const user = await this.database.query<BusinessUserRow>(
      `SELECT id, password_hash, global_status
       FROM users
       WHERE lower(email::text) = lower($1) OR phone_number = $1
       LIMIT 1`,
      [normalizedIdentity],
    );
    const row = user.rows[0];
    if (!row) return undefined;

    return {
      id: row.id,
      identityType: 'BUSINESS_USER',
      passwordHash: row.password_hash,
      status: row.global_status,
      contexts: await this.findActiveContexts(row.id),
    };
  }

  async findActiveContexts(userId: string): Promise<V2AuthorizationContext[]> {
    const result = await this.database.query<AuthorizationContextRow>(
      `SELECT
         membership.id AS membership_id,
         role_assignment.id AS membership_role_id,
         role_assignment.role_code,
         membership.business_id,
         work_assignment.id AS work_assignment_id,
         work_assignment.assignment_type,
         work_assignment.branch_id
       FROM business_user_memberships membership
       JOIN businesses business
         ON business.id = membership.business_id
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.status = 'ACTIVE'
       LEFT JOIN user_work_assignments work_assignment
         ON work_assignment.membership_role_id = role_assignment.id
        AND work_assignment.status = 'ACTIVE'
       WHERE membership.user_id = $1
         AND membership.status = 'ACTIVE'
         AND business.status = 'ACTIVE'
       ORDER BY
         membership.business_id,
         role_assignment.role_code,
         work_assignment.is_primary_context DESC NULLS LAST,
         work_assignment.created_at,
         work_assignment.id`,
      [userId],
    );

    return result.rows.map((row) => ({
      membershipId: row.membership_id,
      membershipRoleId: row.membership_role_id,
      role: row.role_code,
      businessId: row.business_id,
      workAssignmentId: row.work_assignment_id ?? undefined,
      workScope: row.assignment_type ?? undefined,
      branchId: row.branch_id ?? undefined,
    }));
  }

  private async findPlatformAdmin(
    identity: string,
  ): Promise<V2AuthIdentity | undefined> {
    const result = await this.database.query<PlatformAdminRow>(
      `SELECT id, password_hash, status
       FROM platform_admin
       WHERE lower(email::text) = lower($1) OR phone_number = $1
       LIMIT 1`,
      [identity],
    );
    const row = result.rows[0];
    if (!row) return undefined;

    return {
      id: row.id,
      identityType: 'PLATFORM_ADMIN',
      passwordHash: row.password_hash,
      status: row.status,
      contexts: [],
    };
  }
}
