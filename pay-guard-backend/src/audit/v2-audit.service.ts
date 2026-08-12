import { Injectable } from '@nestjs/common';
import { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service';
import { DaoTransaction } from '../database/central.dao';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { requestContext } from '../common/request-context';
import { sanitizeAuditMetadata, sanitizeAuditText } from './audit-sanitizer';

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
         platform_admin_session_id, result, failure_reason, correlation_id
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14, $15, $16, $17
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
        serializeMetadata(event.previousValue),
        serializeMetadata(event.newValue),
        sanitizeAuditText(event.reason),
        isAdmin ? null : (event.sessionId ?? null),
        isAdmin ? (event.sessionId ?? null) : null,
        event.result ?? 'SUCCESS',
        sanitizeAuditText(event.failureReason),
        requestContext.getStore()?.correlationId ?? 'system',
      ],
    );
  }
}

function serializeMetadata(value: Record<string, unknown> | undefined): string | null {
  const sanitized = sanitizeAuditMetadata(value);
  return sanitized ? JSON.stringify(sanitized) : null;
}

export function auditActorFromPrincipal(
  actor: AuthenticatedPrincipal,
): V2SelectedAuthContext {
  return {
    identityType: actor.identityType === 'PLATFORM_ADMIN'
      ? 'PLATFORM_ADMIN' : 'BUSINESS_USER',
    subjectId: actor.userId,
    role: actor.role === 'BUSINESS_OWNER' ? 'PRIMARY_OWNER' : actor.role,
    businessId: actor.businessIds.length === 1 ? actor.businessIds[0] : undefined,
    membershipId: actor.membershipId,
    membershipRoleId: actor.membershipRoleId,
    workAssignmentId: actor.workAssignmentId,
    branchId: actor.branchId,
  };
}
