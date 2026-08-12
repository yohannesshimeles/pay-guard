import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { DaoTransaction } from '../database/central.dao';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';

export type V2AuditEvent = {
  actor: V2SelectedAuthContext;
  sessionId?: string;
  actionType: string;
  recordType: string;
  recordId?: string;
  businessId?: string;
  branchId?: string;
  result?: 'SUCCESS' | 'FAILURE';
  failureReason?: string;
  previousValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  reason?: string;
};

@Injectable()
export class V2AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(event: V2AuditEvent): Promise<void> {
    await this.write(
      (text, values) => this.database.query(text, values),
      event,
    );
  }

  async recordWithClient(
    client: PoolClient,
    event: V2AuditEvent,
  ): Promise<void> {
    await this.write((text, values) => client.query(text, [...values]), event);
  }

  async recordWithin(
    transaction: DaoTransaction,
    event: V2AuditEvent,
  ): Promise<void> {
    await this.write((text, values) => transaction.query(text, values), event);
  }

  private async write(
    query: (text: string, values: readonly unknown[]) => Promise<unknown>,
    event: V2AuditEvent,
  ): Promise<void> {
    const isAdmin = event.actor.identityType === 'PLATFORM_ADMIN';
    await query(
      `INSERT INTO audit_logs (
         user_id, platform_admin_id, membership_id, role_code,
         business_id, branch_id, action_type, record_type, record_id,
         previous_value, new_value, reason, session_id,
         platform_admin_session_id, result, failure_reason
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16
       )`,
      [
        isAdmin ? null : event.actor.subjectId,
        isAdmin ? event.actor.subjectId : null,
        event.actor.membershipId ?? null,
        event.actor.role,
        event.businessId ?? event.actor.businessId ?? null,
        event.branchId ?? event.actor.branchId ?? null,
        event.actionType,
        event.recordType,
        event.recordId ?? null,
        event.previousValue ? JSON.stringify(event.previousValue) : null,
        event.newValue ? JSON.stringify(event.newValue) : null,
        event.reason ?? null,
        isAdmin ? null : (event.sessionId ?? null),
        isAdmin ? (event.sessionId ?? null) : null,
        event.result ?? 'SUCCESS',
        event.failureReason ?? null,
      ],
    );
  }
}
