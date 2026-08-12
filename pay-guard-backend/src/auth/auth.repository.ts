import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { AuthUser, RoleCode } from './auth.types';

type UserRow = {
  id: string;
  password_hash: string;
  status: AuthUser['status'];
  role_code: RoleCode;
  business_ids: string[] | null;
  branch_id: string | null;
};

type SessionRow = {
  id: string;
  user_id: string;
  device_id: string | null;
  expires_at: Date;
  revoked_at: Date | null;
};

@Injectable()
export class AuthRepository {
  constructor(private readonly database: DatabaseService) {}

  async findUserByIdentity(identity: string): Promise<AuthUser | undefined> {
    const result = await this.database.query<UserRow>(
      `SELECT
        u.id,
        u.password_hash,
        u.status,
        ur.role_code,
        COALESCE(array_agg(DISTINCT COALESCE(bo.business_id, br.business_id))
          FILTER (WHERE COALESCE(bo.business_id, br.business_id) IS NOT NULL),
          '{}') AS business_ids,
        bua.branch_id
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN business_owners bo ON bo.user_id = u.id
      LEFT JOIN branch_user_assignments bua
        ON bua.user_id = u.id AND bua.active = true
      LEFT JOIN branches br ON br.id = bua.branch_id
      WHERE lower(u.email) = lower($1) OR u.phone = $1
      GROUP BY u.id, u.password_hash, u.status, ur.role_code, bua.branch_id
      LIMIT 1`,
      [identity],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      passwordHash: row.password_hash,
      status: row.status,
      role: row.role_code,
      businessIds: row.business_ids ?? [],
      branchId: row.branch_id ?? undefined,
    };
  }

  async createSession(input: {
    userId: string;
    role: RoleCode;
    refreshTokenHash: string;
    expiresAt: Date;
    deviceIdentifierHash?: string;
    devicePlatform?: string;
  }): Promise<{ sessionId: string; deviceId?: string }> {
    return this.database.transaction(async (client) => {
      let deviceId: string | undefined;
      if (input.role === 'WAITER') {
        await client.query(
          `UPDATE sessions SET revoked_at = now()
           WHERE user_id = $1 AND revoked_at IS NULL`,
          [input.userId],
        );
        await client.query(
          `UPDATE devices SET active = false
           WHERE user_id = $1 AND active = true`,
          [input.userId],
        );
        const device = await client.query<{ id: string }>(
          `INSERT INTO devices (
            user_id, device_identifier_hash, platform
          ) VALUES ($1, $2, $3) RETURNING id`,
          [
            input.userId,
            input.deviceIdentifierHash ?? 'unregistered',
            input.devicePlatform ?? 'android',
          ],
        );
        deviceId = device.rows[0].id;
      }

      const session = await client.query<{ id: string }>(
        `INSERT INTO sessions (
          user_id, device_id, refresh_token_hash, expires_at
        ) VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          input.userId,
          deviceId ?? null,
          input.refreshTokenHash,
          input.expiresAt,
        ],
      );
      return { sessionId: session.rows[0].id, deviceId };
    });
  }

  async findActiveSessionByTokenHash(
    refreshTokenHash: string,
  ): Promise<SessionRow | undefined> {
    const result = await this.database.query<SessionRow>(
      `SELECT id, user_id, device_id, expires_at, revoked_at
       FROM sessions
       WHERE refresh_token_hash = $1
         AND revoked_at IS NULL
         AND expires_at > now()`,
      [refreshTokenHash],
    );
    return result.rows[0];
  }

  async rotateSession(
    sessionId: string,
    currentHash: string,
    nextHash: string,
    nextExpiry: Date,
  ): Promise<boolean> {
    const result = await this.database.query(
      `UPDATE sessions
       SET refresh_token_hash = $1, expires_at = $2, last_used_at = now()
       WHERE id = $3 AND refresh_token_hash = $4 AND revoked_at IS NULL`,
      [nextHash, nextExpiry, sessionId, currentHash],
    );
    return result.rowCount === 1;
  }

  async revokeSession(sessionId: string, userId: string): Promise<void> {
    await this.database.transaction(async (client: PoolClient) => {
      await client.query(
        `UPDATE sessions SET revoked_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, userId],
      );
      await client.query(
        `UPDATE devices SET active = false
         WHERE id = (SELECT device_id FROM sessions WHERE id = $1)`,
        [sessionId],
      );
    });
  }

  async isSessionActive(sessionId: string, userId: string): Promise<boolean> {
    const result = await this.database.query(
      `SELECT 1
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       LEFT JOIN devices d ON d.id = s.device_id
       WHERE s.id = $1
         AND s.user_id = $2
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.status = 'ACTIVE'
         AND (s.device_id IS NULL OR d.active = true)`,
      [sessionId, userId],
    );
    return result.rowCount === 1;
  }

  async getUserContext(userId: string): Promise<AuthUser | undefined> {
    const result = await this.database.query<UserRow>(
      `SELECT
        u.id,
        u.password_hash,
        u.status,
        ur.role_code,
        COALESCE(array_agg(DISTINCT COALESCE(bo.business_id, br.business_id))
          FILTER (WHERE COALESCE(bo.business_id, br.business_id) IS NOT NULL),
          '{}') AS business_ids,
        bua.branch_id
      FROM users u
      JOIN user_roles ur ON ur.user_id = u.id
      LEFT JOIN business_owners bo ON bo.user_id = u.id
      LEFT JOIN branch_user_assignments bua
        ON bua.user_id = u.id AND bua.active = true
      LEFT JOIN branches br ON br.id = bua.branch_id
      WHERE u.id = $1
      GROUP BY u.id, u.password_hash, u.status, ur.role_code, bua.branch_id`,
      [userId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
      id: row.id,
      passwordHash: row.password_hash,
      status: row.status,
      role: row.role_code,
      businessIds: row.business_ids ?? [],
      branchId: row.branch_id ?? undefined,
    };
  }
}
