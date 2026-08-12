import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { AuditQueryDto } from './dto/audit-query.dto';

export type AuditQueryScope = Readonly<{
  businessId?: string;
  branchId?: string;
  platform: boolean;
}>;

type AuditRow = {
  id: string;
  actor_type: 'BUSINESS_USER' | 'PLATFORM_ADMIN' | 'SYSTEM';
  actor_id: string | null;
  role_code: string | null;
  business_id: string | null;
  branch_id: string | null;
  action_type: string;
  record_type: string;
  record_id: string | null;
  previous_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  reason: string | null;
  result: 'SUCCESS' | 'FAILURE';
  failure_reason: string | null;
  correlation_id: string;
  created_at: Date;
  total_count: string;
};

@Injectable()
export class AuditQueryDao {
  constructor(private readonly dao: CentralDao) {}

  async list(scope: AuditQueryScope, input: AuditQueryDto) {
    const businessId = scope.businessId ?? input.businessId ?? null;
    const branchId = scope.branchId ?? input.branchId ?? null;
    const rows = await this.dao.many<AuditRow>(
      `SELECT audit.id,
              CASE WHEN audit.platform_admin_id IS NOT NULL THEN 'PLATFORM_ADMIN'
                   WHEN audit.user_id IS NOT NULL THEN 'BUSINESS_USER'
                   ELSE 'SYSTEM' END AS actor_type,
              COALESCE(audit.platform_admin_id, audit.user_id) AS actor_id,
              audit.role_code, audit.business_id, audit.branch_id,
              audit.action_type, audit.record_type, audit.record_id,
              audit.previous_value, audit.new_value, audit.reason,
              audit.result, audit.failure_reason, audit.correlation_id,
              audit.created_at, COUNT(*) OVER()::text AS total_count
       FROM audit_logs audit
       WHERE ($1::uuid IS NULL OR audit.business_id = $1)
         AND ($2::uuid IS NULL OR audit.branch_id = $2)
         AND ($3::varchar IS NULL OR audit.action_type = $3)
         AND ($4::varchar IS NULL OR audit.record_type = $4)
         AND ($5::varchar IS NULL OR audit.result = $5)
         AND ($6::timestamptz IS NULL OR audit.created_at >= $6)
         AND ($7::timestamptz IS NULL OR audit.created_at <= $7)
       ORDER BY audit.created_at DESC, audit.id DESC
       LIMIT $8 OFFSET $9`,
      [businessId, branchId, input.actionType ?? null, input.recordType ?? null,
       input.result ?? null, input.dateFrom ?? null, input.dateTo ?? null,
       input.limit, input.offset],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        actorType: row.actor_type,
        actorId: row.actor_id,
        role: row.role_code,
        businessId: row.business_id,
        branchId: row.branch_id,
        actionType: row.action_type,
        recordType: row.record_type,
        recordId: row.record_id,
        previousValue: row.previous_value,
        newValue: row.new_value,
        reason: row.reason,
        result: row.result,
        failureReason: row.failure_reason,
        correlationId: row.correlation_id,
        createdAt: row.created_at,
      })),
      total: rows.length ? Number(rows[0].total_count) : 0,
      limit: input.limit,
      offset: input.offset,
    };
  }
}
