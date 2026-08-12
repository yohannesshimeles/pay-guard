import { Injectable } from '@nestjs/common';
import { DaoTransaction } from '../database/central.dao';

@Injectable()
export class NotificationAudienceDao {
  notifyFinancialOversightWithin(
    transaction: DaoTransaction,
    input: {
      operation: 'MANUAL_DEPOSIT' | 'WITHDRAWAL' | 'CORRECTION';
      recordId: string; businessId: string; branchId: string;
      excludeUserId?: string;
    },
  ) {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_user_id, business_id, branch_id, title, message,
         notification_type, template_key, idempotency_key, variables_json
       )
       SELECT DISTINCT membership.user_id, $3, $4,
         'Branch financial activity',
         'A ' || lower(replace($1, '_', ' ')) ||
           ' record was posted for branch ' || $4 || '.',
         'FINANCIAL_EVENT', 'FINANCIAL_OPERATION_EVENT',
         'financial-event:' || $1 || ':' || $2 || ':user:' || membership.user_id,
         jsonb_build_object('operation', $1, 'branchId', $4)
       FROM business_user_memberships membership
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.status = 'ACTIVE'
        AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER','MANAGER')
       JOIN user_work_assignments assignment
         ON assignment.membership_role_id = role_assignment.id
        AND assignment.business_id = $3 AND assignment.status = 'ACTIVE'
        AND (assignment.assignment_type = 'MAIN_BUSINESS'
          OR assignment.branch_id = $4)
       LEFT JOIN notification_preferences preference
         ON preference.user_id = membership.user_id
        AND preference.notification_type = 'FINANCIAL_EVENT'
       WHERE membership.business_id = $3 AND membership.status = 'ACTIVE'
         AND ($5::uuid IS NULL OR membership.user_id <> $5)
         AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [input.operation, input.recordId, input.businessId, input.branchId,
       input.excludeUserId ?? null],
    );
  }

  notifyReconciliationReviewWithin(
    transaction: DaoTransaction,
    input: {
      reconciliationId: string; businessId: string; branchId: string;
      status: string; excludeUserId?: string;
    },
  ) {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_user_id, business_id, branch_id, title, message,
         notification_type, template_key, idempotency_key, variables_json
       )
       SELECT DISTINCT membership.user_id, $2, $3, 'Reconciliation update',
         'Branch ' || $3 || ' reconciliation is now ' || lower($4) || '.',
         'RECONCILIATION_EVENT', 'RECONCILIATION_STATUS_EVENT',
         'reconciliation-status:' || $1 || ':' || $4 || ':user:' || membership.user_id,
         jsonb_build_object('branchId', $3, 'status', $4)
       FROM business_user_memberships membership
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.status = 'ACTIVE'
        AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER','MANAGER')
       JOIN user_work_assignments assignment
         ON assignment.membership_role_id = role_assignment.id
        AND assignment.business_id = $2 AND assignment.status = 'ACTIVE'
        AND (assignment.assignment_type = 'MAIN_BUSINESS'
          OR assignment.branch_id = $3)
       LEFT JOIN notification_preferences preference
         ON preference.user_id = membership.user_id
        AND preference.notification_type = 'RECONCILIATION_EVENT'
       WHERE membership.business_id = $2 AND membership.status = 'ACTIVE'
         AND ($5::uuid IS NULL OR membership.user_id <> $5)
         AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [input.reconciliationId, input.businessId, input.branchId, input.status,
       input.excludeUserId ?? null],
    );
  }

  notifyReconciliationSubmitterWithin(
    transaction: DaoTransaction,
    input: { reconciliationId: string; status: string },
  ) {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_user_id, business_id, branch_id, title, message,
         notification_type, template_key, idempotency_key, variables_json
       )
       SELECT membership.user_id, reconciliation.business_id,
         reconciliation.branch_id, 'Reconciliation update',
         'Branch ' || reconciliation.branch_id ||
           ' reconciliation is now ' || lower($2) || '.',
         'RECONCILIATION_EVENT', 'RECONCILIATION_STATUS_EVENT',
         'reconciliation-status:' || reconciliation.id || ':' || $2 ||
           ':user:' || membership.user_id,
         jsonb_build_object('branchId', reconciliation.branch_id, 'status', $2)
       FROM reconciliations reconciliation
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = reconciliation.submitted_by_role_assignment_id
       JOIN business_user_memberships membership
         ON membership.id = role_assignment.membership_id
       LEFT JOIN notification_preferences preference
         ON preference.user_id = membership.user_id
        AND preference.notification_type = 'RECONCILIATION_EVENT'
       WHERE reconciliation.id = $1 AND membership.status = 'ACTIVE'
         AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [input.reconciliationId, input.status],
    );
  }

  notifyTransactionSubmitterWithin(
    transaction: DaoTransaction,
    input: { transactionId: string; status: string },
  ) {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_user_id, business_id, branch_id, title, message,
         notification_type, template_key, idempotency_key, variables_json
       )
       SELECT submitted.submitted_by_user_id, submitted.business_id,
         submitted.branch_id, 'Payment verification update',
         'Your submitted payment is now ' || lower($2) || '.',
         'TRANSACTION_UPDATE', 'TRANSACTION_STATUS_UPDATE',
         'transaction-status:' || submitted.id || ':' || $2,
         jsonb_build_object('status', $2)
       FROM customer_transactions submitted
       LEFT JOIN notification_preferences preference
         ON preference.user_id = submitted.submitted_by_user_id
        AND preference.notification_type = 'TRANSACTION_UPDATE'
       WHERE submitted.id = $1 AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [input.transactionId, input.status],
    );
  }

  notifyCreditThresholdsWithin(
    transaction: DaoTransaction,
    triggerEventId: string,
  ) {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_user_id, business_id, branch_id, title, message,
         notification_type, template_key, idempotency_key, variables_json
       )
       SELECT DISTINCT membership.user_id, alert.business_id, alert.branch_id,
         'Branch credit usage alert',
         'Branch ' || alert.branch_id || ' reached ' ||
           alert.threshold_percent::text || '% credit usage; ' ||
           GREATEST(alert.allocated_credits - alert.used_credits -
                    alert.expired_credits, 0)::text || ' remain.',
         'CREDIT_ALERT', 'CREDIT_USAGE_THRESHOLD',
         'credit-threshold:' || alert.id || ':user:' || membership.user_id,
         jsonb_build_object(
           'branchId', alert.branch_id,
           'thresholdPercent', alert.threshold_percent,
           'remainingCredits', GREATEST(alert.allocated_credits -
             alert.used_credits - alert.expired_credits, 0))
       FROM credit_usage_alerts alert
       JOIN business_user_memberships membership
         ON membership.business_id = alert.business_id
        AND membership.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.membership_id = membership.id
        AND role_assignment.status = 'ACTIVE'
        AND role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER','MANAGER')
       JOIN user_work_assignments assignment
         ON assignment.membership_role_id = role_assignment.id
        AND assignment.business_id = alert.business_id
        AND assignment.status = 'ACTIVE'
        AND (assignment.assignment_type = 'MAIN_BUSINESS'
          OR assignment.branch_id = alert.branch_id)
       LEFT JOIN notification_preferences preference
         ON preference.user_id = membership.user_id
        AND preference.notification_type = 'CREDIT_ALERT'
       WHERE alert.trigger_event_id = $1
         AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [triggerEventId],
    );
  }

  notifyProviderIncidentWithin(
    transaction: DaoTransaction,
    input: { alertId: string; errorCode: string },
  ) {
    return transaction.execute(
      `INSERT INTO notifications (
         recipient_platform_admin_id, title, message, notification_type,
         template_key, idempotency_key, variables_json
       )
       SELECT admin.id, 'Verification provider incident',
         'Verify.ET requires operational review (' || $2 || ').',
         'INCIDENT_ALERT', 'PROVIDER_INCIDENT_ALERT',
         'provider-incident:' || $1 || ':platform-admin:' || admin.id,
         jsonb_build_object('provider', 'Verify.ET', 'incidentType', $2)
       FROM platform_admin admin
       LEFT JOIN notification_preferences preference
         ON preference.platform_admin_id = admin.id
        AND preference.notification_type = 'INCIDENT_ALERT'
       WHERE admin.status = 'ACTIVE'
         AND COALESCE(preference.in_app_enabled, true)
       ON CONFLICT (idempotency_key) WHERE idempotency_key IS NOT NULL
       DO NOTHING`,
      [input.alertId, input.errorCode],
    );
  }
}
