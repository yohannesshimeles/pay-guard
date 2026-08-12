import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { requestContext } from '../common/request-context';

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
        actor_user_id, business_id, branch_id, action, target_type,
        target_id, metadata, correlation_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        event.actorUserId ?? null,
        event.businessId ?? null,
        event.branchId ?? null,
        event.action,
        event.targetType ?? null,
        event.targetId ?? null,
        JSON.stringify(event.metadata ?? {}),
        requestContext.getStore()?.correlationId ?? 'system',
      ],
    );
  }
}
