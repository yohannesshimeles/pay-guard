import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { FinancialReportScope } from './financial-report.dao';

type StatusCount = { status: string; count: number };
type OperationCount = { operation: string; count: number };
type ResponseClassCount = { responseClass: string; count: number };

type BusinessOperationalRow = {
  verification_statuses: StatusCount[];
  purchased_credits: string;
  used_credits: string;
  expired_credits: string;
  available_credits: string;
  subscription_statuses: StatusCount[];
  invoice_count: string;
  invoiced_total: string;
  fraud_attempt_count: string;
  open_fraud_flag_count: string;
  active_purchase_lock_count: string;
};

type ProviderOperationalRow = {
  request_statuses: StatusCount[];
  operations: OperationCount[];
  response_classes: ResponseClassCount[];
  average_response_ms: string | null;
  open_incident_count: string;
  acknowledged_incident_count: string;
};

@Injectable()
export class OperationalReportDao {
  constructor(private readonly dao: CentralDao) {}

  async businessSummary(scope: FinancialReportScope, input: {
    branchId?: string; dateFrom: string; dateTo: string;
  }) {
    const branchId = scope.branchId ?? input.branchId ?? null;
    const row = await this.dao.one<BusinessOperationalRow>(
      `WITH verification_status AS (
         SELECT attempt.result_status AS status, COUNT(*)::integer AS count
         FROM verification_attempts attempt
         JOIN customer_transactions transaction ON transaction.id = attempt.transaction_id
         WHERE attempt.business_id = $1
           AND ($2::uuid IS NULL OR transaction.branch_id = $2)
           AND attempt.created_at >= $3::date
           AND attempt.created_at < $4::date + interval '1 day'
         GROUP BY attempt.result_status
       ), credit AS (
         SELECT COALESCE(SUM(purchased_credits), 0)::text AS purchased_credits,
                COALESCE(SUM(used_credits), 0)::text AS used_credits,
                COALESCE(SUM(expired_credits), 0)::text AS expired_credits,
                COALESCE(SUM(available_credits), 0)::text AS available_credits
         FROM branch_credit_wallets
         WHERE business_id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
       ), subscription_status AS (
         SELECT status, COUNT(*)::integer AS count
         FROM subscription_orders
         WHERE business_id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
           AND created_at >= $3::date
           AND created_at < $4::date + interval '1 day'
         GROUP BY status
       ), invoice AS (
         SELECT COUNT(*)::text AS invoice_count,
                COALESCE(SUM(amount_etb), 0)::text AS invoiced_total
         FROM subscription_invoices
         WHERE business_id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
           AND issued_at >= $3::date
           AND issued_at < $4::date + interval '1 day'
       ), fraud AS (
         SELECT COUNT(*)::text AS fraud_attempt_count
         FROM subscription_fraud_attempts
         WHERE business_id = $1 AND ($2::uuid IS NULL OR branch_id = $2)
           AND detected_at >= $3::date
           AND detected_at < $4::date + interval '1 day'
       )
       SELECT COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.status)
                         FROM verification_status item), '[]'::jsonb)
                AS verification_statuses,
              credit.purchased_credits, credit.used_credits,
              credit.expired_credits, credit.available_credits,
              COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.status)
                         FROM subscription_status item), '[]'::jsonb)
                AS subscription_statuses,
              invoice.invoice_count, invoice.invoiced_total,
              fraud.fraud_attempt_count,
              (SELECT COUNT(*)::text FROM fraud_flags flag
               WHERE flag.business_id = $1 AND flag.status = 'OPEN'
                 AND ($2::uuid IS NULL OR EXISTS (
                   SELECT 1 FROM subscription_orders scoped_order
                   WHERE scoped_order.id = flag.related_order_id
                     AND scoped_order.branch_id = $2))) AS open_fraud_flag_count,
              (SELECT COUNT(*)::text FROM subscription_purchase_locks purchase_lock
               WHERE purchase_lock.business_id = $1
                 AND purchase_lock.status IN ('ACTIVE','RECOVERY_ISSUED'))
                AS active_purchase_lock_count
       FROM credit CROSS JOIN invoice CROSS JOIN fraud`,
      [scope.businessId, branchId, input.dateFrom, input.dateTo],
    );
    return {
      businessId: scope.businessId, branchId: branchId ?? undefined,
      dateFrom: input.dateFrom, dateTo: input.dateTo,
      verification: { statuses: row.verification_statuses },
      credits: {
        purchased: row.purchased_credits, used: row.used_credits,
        expired: row.expired_credits, available: row.available_credits,
      },
      subscriptions: {
        statuses: row.subscription_statuses,
        invoiceCount: Number(row.invoice_count),
        invoicedTotal: row.invoiced_total, currency: 'ETB' as const,
      },
      fraud: {
        attemptCount: Number(row.fraud_attempt_count),
        openFlagCount: Number(row.open_fraud_flag_count),
        activePurchaseLockCount: Number(row.active_purchase_lock_count),
      },
    };
  }

  async providerSummary(input: { dateFrom: string; dateTo: string }) {
    const row = await this.dao.one<ProviderOperationalRow>(
      `WITH request_status AS (
         SELECT request_status AS status, COUNT(*)::integer AS count
         FROM verifyet_provider_requests
         WHERE created_at >= $1::date
           AND created_at < $2::date + interval '1 day'
         GROUP BY request_status
       ), operation AS (
         SELECT operation, COUNT(*)::integer AS count
         FROM verifyet_provider_requests
         WHERE created_at >= $1::date
           AND created_at < $2::date + interval '1 day'
         GROUP BY operation
       ), response_class AS (
         SELECT (http_status / 100)::text || 'xx' AS response_class,
                COUNT(*)::integer AS count
         FROM verifyet_provider_responses
         WHERE received_at >= $1::date
           AND received_at < $2::date + interval '1 day'
         GROUP BY http_status / 100
       )
       SELECT COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.status)
                         FROM request_status item), '[]'::jsonb) AS request_statuses,
              COALESCE((SELECT jsonb_agg(to_jsonb(item) ORDER BY item.operation)
                         FROM operation item), '[]'::jsonb) AS operations,
              COALESCE((SELECT jsonb_agg(jsonb_build_object(
                         'responseClass', item.response_class, 'count', item.count)
                         ORDER BY item.response_class)
                         FROM response_class item), '[]'::jsonb) AS response_classes,
              (SELECT AVG(response_time_ms)::numeric(18,2)::text
               FROM verification_attempts
               WHERE responded_at >= $1::date
                 AND responded_at < $2::date + interval '1 day'
                 AND response_time_ms IS NOT NULL) AS average_response_ms,
              (SELECT COUNT(*)::text FROM security_alerts
               WHERE alert_type = 'VERIFYET_PROVIDER_FAILURE'
                 AND acknowledged_at IS NULL
                 AND created_at >= $1::date
                 AND created_at < $2::date + interval '1 day') AS open_incident_count,
              (SELECT COUNT(*)::text FROM security_alerts
               WHERE alert_type = 'VERIFYET_PROVIDER_FAILURE'
                 AND acknowledged_at IS NOT NULL
                 AND created_at >= $1::date
                 AND created_at < $2::date + interval '1 day')
                AS acknowledged_incident_count`,
      [input.dateFrom, input.dateTo],
    );
    return {
      dateFrom: input.dateFrom, dateTo: input.dateTo,
      requests: { statuses: row.request_statuses, operations: row.operations },
      responses: {
        classes: row.response_classes,
        averageResponseMs: row.average_response_ms,
      },
      incidents: {
        open: Number(row.open_incident_count),
        acknowledged: Number(row.acknowledged_incident_count),
      },
    };
  }
}
