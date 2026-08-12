import { Injectable } from '@nestjs/common';
import { deterministicUuid } from '../common/deterministic-uuid';
import { DaoTransaction } from '../database/central.dao';
import { FraudAlertDao } from '../fraud/fraud-alert.dao';

export type SubscriptionReuseClassification = 'SAME_DAY' | 'CROSS_DAY_FRAUD';

export function classifySubscriptionReuse(
  originalTransactionDate: string | Date,
  attemptedTransactionDate: string | Date,
): SubscriptionReuseClassification {
  return subscriptionTransactionDateKey(originalTransactionDate) ===
    subscriptionTransactionDateKey(attemptedTransactionDate)
    ? 'SAME_DAY'
    : 'CROSS_DAY_FRAUD';
}

export function subscriptionTransactionDateKey(value: string | Date): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

@Injectable()
export class SubscriptionFraudDao {
  constructor(private readonly alerts: FraudAlertDao) {}

  async recordCrossDayReuseWithin(transaction: DaoTransaction, input: {
    businessId: string; branchId: string; orderId: string;
    verificationId: string; originalVerificationId: string;
    paymentBankId: string; transactionReference: string;
    originalTransactionDate: string; attemptedTransactionDate: string;
  }) {
    await transaction.execute(
      `SELECT pg_advisory_xact_lock(hashtextextended('subscription-fraud:' || $1, 0))`,
      [input.businessId],
    );
    const rule = await transaction.one<{
      qualifying_attempt_threshold: number; window_days: number;
    }>(
      `SELECT qualifying_attempt_threshold, window_days
       FROM subscription_fraud_rules
       WHERE rule_key = 'SUBSCRIPTION_CROSS_DAY_REUSE'`,
    );
    const existing = await transaction.optional<{
      qualifying_attempt_number: number; fraud_flag_id: string;
    }>(
      `SELECT qualifying_attempt_number, fraud_flag_id
       FROM subscription_fraud_attempts WHERE verification_id = $1`,
      [input.verificationId],
    );
    if (existing) {
      const activeLock = await this.activeLock(transaction, input.businessId);
      return { attemptNumber: existing.qualifying_attempt_number,
        purchaseLocked: Boolean(activeLock), replayed: true };
    }
    const count = await transaction.one<{ count: string }>(
      `SELECT count(*)::text AS count FROM subscription_fraud_attempts
       WHERE business_id = $1
         AND detected_at >= now() - make_interval(days => $2::int)`,
      [input.businessId, rule.window_days],
    );
    const attemptNumber = Number(count.count) + 1;
    const attemptId = deterministicUuid(`subscription-fraud-attempt:${input.verificationId}`);
    const attemptFlagId = deterministicUuid(`subscription-fraud-flag:${input.verificationId}`);
    await transaction.one<{ id: string }>(
      `INSERT INTO fraud_flags (
         id, business_id, event_type, related_order_id, details_json,
         trust_score_impact
       ) VALUES ($1,$2,'CROSS_DAY_DUPLICATE',$3,$4::jsonb,-5)
       RETURNING id`,
      [attemptFlagId, input.businessId, input.orderId, JSON.stringify({
        classification: 'CROSS_DAY_FRAUD', attemptNumber,
        verificationId: input.verificationId,
        originalVerificationId: input.originalVerificationId,
        paymentBankId: input.paymentBankId,
        transactionReference: input.transactionReference,
        originalTransactionDate: input.originalTransactionDate,
        attemptedTransactionDate: input.attemptedTransactionDate,
        ruleWindowDays: rule.window_days,
      })],
    );
    await transaction.one<{ id: string }>(
      `INSERT INTO subscription_fraud_attempts (
         id, fraud_flag_id, business_id, branch_id, order_id, verification_id,
         original_verification_id, payment_bank_id, transaction_reference,
         original_transaction_date, attempted_transaction_date, classification,
         qualifying_attempt_number, rule_window_days, fraud_alert_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'CROSS_DAY_FRAUD',$12,$13,$14)
       RETURNING id`,
      [attemptId, attemptFlagId, input.businessId, input.branchId, input.orderId,
       input.verificationId, input.originalVerificationId, input.paymentBankId,
       input.transactionReference, input.originalTransactionDate,
       input.attemptedTransactionDate, attemptNumber, rule.window_days,
       (await this.alerts.createWithin(transaction, {
         verificationId: input.verificationId, fraudFlagId: attemptFlagId,
         businessId: input.businessId, branchId: input.branchId,
         orderId: input.orderId, attemptNumber,
         threshold: rule.qualifying_attempt_threshold,
         ruleWindowDays: rule.window_days,
         purchaseLocked: attemptNumber >= rule.qualifying_attempt_threshold,
       })).id],
    );
    let purchaseLocked = Boolean(await this.activeLock(transaction, input.businessId));
    if (!purchaseLocked && attemptNumber >= rule.qualifying_attempt_threshold) {
      const thresholdFlagId = deterministicUuid(
        `subscription-fraud-threshold:${input.businessId}:${attemptId}`,
      );
      await transaction.one<{ id: string }>(
        `INSERT INTO fraud_flags (
           id, business_id, event_type, related_order_id, details_json,
           trust_score_impact
         ) VALUES ($1,$2,'THREE_DUPLICATES',$3,$4::jsonb,-15) RETURNING id`,
        [thresholdFlagId, input.businessId, input.orderId, JSON.stringify({
          triggeringAttemptId: attemptId, attemptNumber,
          threshold: rule.qualifying_attempt_threshold,
          ruleWindowDays: rule.window_days,
        })],
      );
      await transaction.one<{ id: string }>(
        `INSERT INTO subscription_purchase_locks (
           id, business_id, fraud_flag_id, status
         ) VALUES ($1,$2,$3,'ACTIVE') RETURNING id`,
        [deterministicUuid(`subscription-purchase-lock:${thresholdFlagId}`),
         input.businessId, thresholdFlagId],
      );
      purchaseLocked = true;
    }
    return { attemptNumber, purchaseLocked, replayed: false };
  }

  private activeLock(transaction: DaoTransaction, businessId: string) {
    return transaction.optional<{ id: string }>(
      `SELECT id FROM subscription_purchase_locks
       WHERE business_id = $1 AND status IN ('ACTIVE','RECOVERY_ISSUED')`,
      [businessId],
    );
  }
}
