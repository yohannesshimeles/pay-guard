import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import {
  V2BusinessSessionInput,
  V2PlatformAdminSessionInput,
  V2Session,
  V2SessionKind,
} from './v2-session.types';
import { V2RoleCode, V2WorkScope } from './v2-auth.types';

type UserSessionRow = {
  id: string;
  user_id: string;
  membership_id: string | null;
  membership_role_id: string | null;
  work_assignment_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
  role_code: Exclude<V2RoleCode, 'PLATFORM_SUPER_ADMIN'>;
  business_id: string;
  assignment_type: V2WorkScope | null;
  branch_id: string | null;
};

type PlatformAdminSessionRow = {
  id: string;
  platform_admin_id: string;
  expires_at: Date;
  revoked_at: Date | null;
};

@Injectable()
export class V2SessionRepository {
  constructor(private readonly database: DatabaseService) {}

  async createBusinessSession(
    input: V2BusinessSessionInput,
  ): Promise<{ sessionId: string }> {
    return this.database.transaction(async (client) => {
      await this.assertActiveContext(client, input);
      const result = await client.query<{ id: string }>(
        `INSERT INTO user_sessions (
           user_id, membership_id, membership_role_id, work_assignment_id,
           refresh_token_hash, expires_at, device_identifier_hash, device_platform
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [
          input.userId,
          input.membershipId,
          input.membershipRoleId,
          input.workAssignmentId ?? null,
          input.refreshTokenHash,
          input.expiresAt,
          input.deviceIdentifierHash ?? null,
          input.devicePlatform ?? null,
        ],
      );
      await client.query(
        `INSERT INTO notifications (
           recipient_user_id, business_id, branch_id, title, message,
           notification_type, template_key, idempotency_key, variables_json
         )
         SELECT $1, membership.business_id, assignment.branch_id,
           'Device session started',
           'A ' || COALESCE($6, 'unknown') ||
             ' device session was started for your Waiter account.',
           'DEVICE_EVENT', 'WAITER_DEVICE_SESSION',
           'waiter-device-session:' || $5,
           jsonb_build_object('platform', COALESCE($6, 'unknown'))
         FROM membership_role_assignments role_assignment
         JOIN business_user_memberships membership
           ON membership.id = role_assignment.membership_id
          AND membership.user_id = $1 AND membership.status = 'ACTIVE'
         LEFT JOIN user_work_assignments assignment ON assignment.id = $4
         LEFT JOIN notification_preferences preference
           ON preference.user_id = $1
          AND preference.notification_type = 'DEVICE_EVENT'
         WHERE role_assignment.id = $3 AND role_assignment.membership_id = $2
           AND role_assignment.role_code = 'WAITER'
           AND role_assignment.status = 'ACTIVE'
           AND COALESCE(preference.in_app_enabled, true)
         ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
         DO NOTHING`,
        [input.userId, input.membershipId, input.membershipRoleId,
         input.workAssignmentId ?? null, result.rows[0].id,
         input.devicePlatform ?? null],
      );
      return { sessionId: result.rows[0].id };
    });
  }

  async createPlatformAdminSession(
    input: V2PlatformAdminSessionInput,
  ): Promise<{ sessionId: string }> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO platform_admin_sessions (
         platform_admin_id, refresh_token_hash, expires_at,
         device_identifier_hash, device_platform
       )
       SELECT admin.id, $2, $3, $4, $5
       FROM platform_admin admin
       WHERE admin.id = $1 AND admin.status = 'ACTIVE'
       RETURNING id`,
      [
        input.platformAdminId,
        input.refreshTokenHash,
        input.expiresAt,
        input.deviceIdentifierHash ?? null,
        input.devicePlatform ?? null,
      ],
    );
    if (!result.rows[0]) throw new Error('Active platform administrator not found');
    return { sessionId: result.rows[0].id };
  }

  async findActiveByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<V2Session | undefined> {
    const userSession = await this.database.query<UserSessionRow>(
      `SELECT session.id, session.user_id, session.membership_id,
              session.membership_role_id, session.work_assignment_id,
              session.expires_at, session.revoked_at,
              role_assignment.role_code, membership.business_id,
              work_assignment.assignment_type, work_assignment.branch_id
       FROM user_sessions session
       JOIN business_user_memberships membership
         ON membership.id = session.membership_id
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = session.membership_role_id
       LEFT JOIN user_work_assignments work_assignment
         ON work_assignment.id = session.work_assignment_id
       WHERE session.refresh_token_hash = $1
         AND session.session_status = 'ACTIVE'
         AND session.revoked_at IS NULL
         AND session.expires_at > now()`,
      [refreshTokenHash],
    );
    const userRow = userSession.rows[0];
    if (userRow) return this.mapUserSession(userRow);

    const adminSession = await this.database.query<PlatformAdminSessionRow>(
      `SELECT id, platform_admin_id, expires_at, revoked_at
       FROM platform_admin_sessions
       WHERE refresh_token_hash = $1
         AND session_status = 'ACTIVE'
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [refreshTokenHash],
    );
    const adminRow = adminSession.rows[0];
    return adminRow ? this.mapAdminSession(adminRow) : undefined;
  }

  async rotateRefreshToken(input: {
    sessionKind: V2SessionKind;
    sessionId: string;
    currentHash: string;
    nextHash: string;
    nextExpiry: Date;
  }): Promise<boolean> {
    const table = this.sessionTable(input.sessionKind);
    const result = await this.database.query(
      `UPDATE ${table}
       SET refresh_token_hash = $1,
           expires_at = $2,
           last_active_at = now(),
           rotated_at = now()
       WHERE id = $3
         AND refresh_token_hash = $4
         AND session_status = 'ACTIVE'
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [input.nextHash, input.nextExpiry, input.sessionId, input.currentHash],
    );
    return result.rowCount === 1;
  }

  async revoke(input: {
    sessionKind: V2SessionKind;
    sessionId: string;
    subjectId: string;
    reason: string;
  }): Promise<boolean> {
    const table = this.sessionTable(input.sessionKind);
    const subjectColumn =
      input.sessionKind === 'BUSINESS_USER' ? 'user_id' : 'platform_admin_id';
    const result = await this.database.query(
      `UPDATE ${table}
       SET session_status = 'REVOKED', revoked_at = now(), revoked_reason = $1
       WHERE id = $2
         AND ${subjectColumn} = $3
         AND session_status = 'ACTIVE'`,
      [input.reason, input.sessionId, input.subjectId],
    );
    return result.rowCount === 1;
  }

  async isActive(input: {
    sessionKind: V2SessionKind;
    sessionId: string;
    subjectId: string;
  }): Promise<boolean> {
    if (input.sessionKind === 'PLATFORM_ADMIN') {
      const result = await this.database.query(
        `SELECT 1
         FROM platform_admin_sessions session
         JOIN platform_admin admin ON admin.id = session.platform_admin_id
         WHERE session.id = $1
           AND session.platform_admin_id = $2
           AND session.session_status = 'ACTIVE'
           AND session.revoked_at IS NULL
           AND session.expires_at > now()
           AND admin.status = 'ACTIVE'`,
        [input.sessionId, input.subjectId],
      );
      return result.rowCount === 1;
    }

    const result = await this.database.query(
      `SELECT 1
       FROM user_sessions session
       JOIN users app_user ON app_user.id = session.user_id
       LEFT JOIN business_user_memberships membership
         ON membership.id = session.membership_id
        AND membership.user_id = session.user_id
       LEFT JOIN businesses business
         ON business.id = membership.business_id
       LEFT JOIN membership_role_assignments role_assignment
         ON role_assignment.id = session.membership_role_id
        AND role_assignment.membership_id = session.membership_id
       LEFT JOIN user_work_assignments work_assignment
         ON work_assignment.id = session.work_assignment_id
        AND work_assignment.membership_role_id = session.membership_role_id
       WHERE session.id = $1
         AND session.user_id = $2
         AND session.session_status = 'ACTIVE'
         AND session.revoked_at IS NULL
         AND session.expires_at > now()
         AND app_user.global_status = 'ACTIVE'
         AND (session.membership_id IS NULL OR membership.status = 'ACTIVE')
         AND (session.membership_id IS NULL OR business.status = 'ACTIVE')
         AND (session.membership_role_id IS NULL OR role_assignment.status = 'ACTIVE')
         AND (session.work_assignment_id IS NULL OR work_assignment.status = 'ACTIVE')`,
      [input.sessionId, input.subjectId],
    );
    return result.rowCount === 1;
  }

  private async assertActiveContext(
    client: PoolClient,
    input: V2BusinessSessionInput,
  ): Promise<void> {
    const result = await client.query(
      `SELECT 1
       FROM users app_user
       JOIN business_user_memberships membership
         ON membership.user_id = app_user.id
        AND membership.id = $2
        AND membership.status = 'ACTIVE'
       JOIN businesses business
         ON business.id = membership.business_id
        AND business.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.id = $3
        AND role_assignment.status = 'ACTIVE'
       LEFT JOIN user_work_assignments work_assignment
         ON work_assignment.membership_role_id = role_assignment.id
        AND work_assignment.id = $4
        AND work_assignment.status = 'ACTIVE'
       WHERE app_user.id = $1
         AND app_user.global_status = 'ACTIVE'
         AND ($4::uuid IS NULL OR work_assignment.id IS NOT NULL)
       FOR SHARE OF app_user, membership, business, role_assignment`,
      [
        input.userId,
        input.membershipId,
        input.membershipRoleId,
        input.workAssignmentId ?? null,
      ],
    );
    if (result.rowCount !== 1) throw new Error('Active authorization context not found');
  }

  private sessionTable(kind: V2SessionKind): string {
    return kind === 'BUSINESS_USER' ? 'user_sessions' : 'platform_admin_sessions';
  }

  private mapUserSession(row: UserSessionRow): V2Session {
    return {
      id: row.id,
      sessionKind: 'BUSINESS_USER',
      subjectId: row.user_id,
      membershipId: row.membership_id ?? undefined,
      membershipRoleId: row.membership_role_id ?? undefined,
      workAssignmentId: row.work_assignment_id ?? undefined,
      role: row.role_code,
      businessId: row.business_id,
      workScope: row.assignment_type ?? undefined,
      branchId: row.branch_id ?? undefined,
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
    };
  }

  private mapAdminSession(row: PlatformAdminSessionRow): V2Session {
    return {
      id: row.id,
      sessionKind: 'PLATFORM_ADMIN',
      subjectId: row.platform_admin_id,
      role: 'PLATFORM_SUPER_ADMIN',
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at ?? undefined,
    };
  }
}
