import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';

type FraudReviewRow = {
  id: string; business_id: string; business_code: string; legal_name: string;
  branch_id: string; branch_code: string; branch_name: string; order_id: string;
  verification_id: string; original_verification_id: string;
  masked_transaction_reference: string; original_transaction_date: string;
  attempted_transaction_date: string; qualifying_attempt_number: number;
  rule_window_days: number; fraud_status: 'OPEN' | 'CLEARED';
  trust_score_impact: number; review_note: string | null; created_at: Date;
  alert_id: string; severity: 'HIGH' | 'CRITICAL';
  alert_acknowledged_at: Date | null; lock_id: string | null;
  lock_status: 'ACTIVE' | 'RECOVERY_ISSUED' | 'UNLOCKED' | null;
};

export type FraudReview = Readonly<{
  id: string; business: { id: string; code: string; legalName: string };
  branch: { id: string; code: string; name: string }; orderId: string;
  verificationId: string; originalVerificationId: string;
  maskedTransactionReference: string; originalTransactionDate: string;
  attemptedTransactionDate: string; qualifyingAttemptNumber: number;
  ruleWindowDays: number; status: 'OPEN' | 'CLEARED';
  severity: 'HIGH' | 'CRITICAL'; trustScoreImpact: number;
  alert: { id: string; acknowledged: boolean };
  purchaseLock?: { id: string; status: 'ACTIVE' | 'RECOVERY_ISSUED' | 'UNLOCKED' };
  reviewNote?: string; createdAt: Date;
}>;

export class FraudReviewNotFoundError extends Error {}

@Injectable()
export class FraudReviewDao {
  constructor(private readonly dao: CentralDao) {}

  async list(input: {
    status?: 'OPEN' | 'CLEARED'; severity?: 'HIGH' | 'CRITICAL';
    businessId?: string; limit: number; offset: number;
  }) {
    const rows = await this.dao.many<FraudReviewRow>(
      `${this.selectSql()}
       WHERE flag.event_type = 'CROSS_DAY_DUPLICATE'
         AND ($1::varchar IS NULL OR flag.status = $1)
         AND ($2::varchar IS NULL OR alert.severity = $2)
         AND ($3::uuid IS NULL OR flag.business_id = $3)
       ORDER BY flag.created_at DESC, flag.id DESC LIMIT $4 OFFSET $5`,
      [input.status ?? null, input.severity ?? null, input.businessId ?? null,
       input.limit, input.offset],
    );
    return rows.map((row) => this.map(row));
  }

  async require(id: string) {
    const row = await this.dao.optional<FraudReviewRow>(
      `${this.selectSql()}
       WHERE flag.id = $1 AND flag.event_type = 'CROSS_DAY_DUPLICATE'`,
      [id],
    );
    if (!row) throw new FraudReviewNotFoundError();
    return this.map(row);
  }

  private selectSql() {
    return `SELECT flag.id, flag.business_id, business.business_code,
      business.legal_name, attempt.branch_id, branch.branch_code,
      branch.branch_name, attempt.order_id, attempt.verification_id,
      attempt.original_verification_id,
      repeat('*', greatest(length(attempt.transaction_reference) - 4, 0)) ||
        right(attempt.transaction_reference, 4) AS masked_transaction_reference,
      attempt.original_transaction_date::text,
      attempt.attempted_transaction_date::text,
      attempt.qualifying_attempt_number, attempt.rule_window_days,
      flag.status AS fraud_status, flag.trust_score_impact, flag.review_note,
      flag.created_at, alert.id AS alert_id, alert.severity,
      alert.acknowledged_at AS alert_acknowledged_at,
      purchase_lock.id AS lock_id, purchase_lock.status AS lock_status
      FROM fraud_flags flag
      JOIN subscription_fraud_attempts attempt ON attempt.fraud_flag_id = flag.id
      JOIN businesses business ON business.id = flag.business_id
      JOIN branches branch ON branch.id = attempt.branch_id
      JOIN security_alerts alert ON alert.id = attempt.fraud_alert_id
      LEFT JOIN subscription_purchase_locks purchase_lock
        ON purchase_lock.business_id = flag.business_id
       AND purchase_lock.status IN ('ACTIVE','RECOVERY_ISSUED')`;
  }

  private map(row: FraudReviewRow): FraudReview {
    return {
      id: row.id,
      business: { id: row.business_id, code: row.business_code,
        legalName: row.legal_name },
      branch: { id: row.branch_id, code: row.branch_code, name: row.branch_name },
      orderId: row.order_id, verificationId: row.verification_id,
      originalVerificationId: row.original_verification_id,
      maskedTransactionReference: row.masked_transaction_reference,
      originalTransactionDate: row.original_transaction_date,
      attemptedTransactionDate: row.attempted_transaction_date,
      qualifyingAttemptNumber: row.qualifying_attempt_number,
      ruleWindowDays: row.rule_window_days, status: row.fraud_status,
      severity: row.severity, trustScoreImpact: row.trust_score_impact,
      alert: { id: row.alert_id, acknowledged: Boolean(row.alert_acknowledged_at) },
      ...(row.lock_id && row.lock_status ? { purchaseLock: {
        id: row.lock_id, status: row.lock_status,
      }} : {}),
      ...(row.review_note ? { reviewNote: row.review_note } : {}),
      createdAt: row.created_at,
    };
  }
}

