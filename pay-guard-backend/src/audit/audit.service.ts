import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { requestContext } from '../common/request-context';
import { sanitizeAuditMetadata } from './audit-sanitizer';

export type AuditEvent = {
  actorUserId?: string;
  businessId?: string;
  branchId?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

@Injectable()
export class AuditService {
  constructor(private readonly database: DatabaseService) {}

  async record(event: AuditEvent): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_logs (
        user_id, business_id, branch_id, action_type, record_type,
        record_id, new_value, result, correlation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'SUCCESS', $8)`,
      [
        event.actorUserId ?? null,
        event.businessId ?? null,
        event.branchId ?? null,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        JSON.stringify(sanitizeAuditMetadata(event.metadata) ?? {}),
        requestContext.getStore()?.correlationId ?? 'system',
      ],
    );
  }
}
