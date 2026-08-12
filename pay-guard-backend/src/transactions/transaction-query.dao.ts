import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { CustomerTransactionStatus } from '../verifications/enums/customer-transaction-status.enum';
import { ReceiptReviewReasonCode } from '../qr-processing/receipt-match-decision.dao';
import { VerificationAttemptResult } from '../verifications/enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../verifications/enums/verification-attempt-type.enum';

export type TransactionQueryScope = Readonly<{
  businessId: string;
  branchId?: string;
  submittedByUserId?: string;
}>;

export type TransactionQueryFilters = Readonly<{
  status?: CustomerTransactionStatus;
  branchId?: string;
  bankId?: string;
  dateFrom?: string;
  dateTo?: string;
  limit: number;
  offset: number;
}>;

type TransactionRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  submitted_by_user_id: string;
  bank_id: string;
  transaction_reference: string;
  amount: string;
  transaction_date: string;
  transaction_time: string;
  masked_receiver_account: string | null;
  submission_method: 'QR_SCAN' | 'DOCUMENT_SCAN' | 'MANUAL';
  current_status: CustomerTransactionStatus;
  failure_reason: string | null;
  finalized_at: Date | null;
  created_at: Date;
  receipt_count: string;
  confirmed: boolean;
  financially_posted: boolean;
};

type HistoryRow = {
  id: string;
  from_status: CustomerTransactionStatus | null;
  to_status: CustomerTransactionStatus;
  reason: string | null;
  transition_source: 'SYSTEM' | 'VERIFYET' | 'CREDIT_POLICY';
  created_at: Date;
};

type ReceiptDecisionRow = {
  id: string;
  receipt_id: string;
  decision: 'MATCHED' | 'REVIEW_REQUIRED';
  reason_code: ReceiptReviewReasonCode | null;
  created_at: Date;
};

type ReceiptDecisionCountRow = {
  decision: 'MATCHED' | 'REVIEW_REQUIRED';
  reason_code: ReceiptReviewReasonCode | null;
  decision_count: string;
};

type VerificationOutcomeRow = {
  id: string;
  attempt_type: VerificationAttemptType;
  attempt_number: number;
  result_status: VerificationAttemptResult;
  requested_at: Date | null;
  responded_at: Date | null;
  response_time_ms: number | null;
  created_at: Date;
};

export type TransactionSummary = Readonly<{
  id: string;
  businessId: string;
  branchId?: string;
  submittedByUserId: string;
  bankId: string;
  transactionReference: string;
  amount: string;
  transactionDate: string;
  transactionTime: string;
  maskedReceiverAccount?: string;
  submissionMethod: 'QR_SCAN' | 'DOCUMENT_SCAN' | 'MANUAL';
  status: CustomerTransactionStatus;
  failureReason?: string;
  finalizedAt?: Date;
  createdAt: Date;
  receiptCount: number;
  hasReceipt: boolean;
  confirmed: boolean;
  financiallyPosted: boolean;
}>;

export type TransactionHistoryEntry = Readonly<{
  id: string;
  fromStatus?: CustomerTransactionStatus;
  toStatus: CustomerTransactionStatus;
  reason?: string;
  transitionSource: 'SYSTEM' | 'VERIFYET' | 'CREDIT_POLICY';
  createdAt: Date;
}>;

@Injectable()
export class TransactionQueryDao {
  constructor(private readonly dao: CentralDao) {}

  async list(
    scope: TransactionQueryScope,
    filters: TransactionQueryFilters,
  ): Promise<TransactionSummary[]> {
    const rows = await this.dao.many<TransactionRow>(
      `${this.selectSql()}
       WHERE transaction.business_id = $1
         AND ($2::uuid IS NULL OR transaction.branch_id = $2)
         AND ($3::uuid IS NULL OR transaction.submitted_by_user_id = $3)
         AND ($4::varchar IS NULL OR transaction.current_status = $4)
         AND ($5::uuid IS NULL OR transaction.bank_id = $5)
         AND ($6::date IS NULL OR transaction.transaction_date >= $6)
         AND ($7::date IS NULL OR transaction.transaction_date <= $7)
       ORDER BY transaction.created_at DESC, transaction.id DESC
       LIMIT $8 OFFSET $9`,
      [
        scope.businessId,
        scope.branchId ?? filters.branchId ?? null,
        scope.submittedByUserId ?? null,
        filters.status ?? null,
        filters.bankId ?? null,
        filters.dateFrom ?? null,
        filters.dateTo ?? null,
        filters.limit,
        filters.offset,
      ],
    );
    return rows.map((row) => this.map(row));
  }

  async find(
    transactionId: string,
    scope: TransactionQueryScope,
  ): Promise<TransactionSummary | undefined> {
    const row = await this.dao.optional<TransactionRow>(
      `${this.selectSql()}
       WHERE transaction.id = $1
         AND transaction.business_id = $2
         AND ($3::uuid IS NULL OR transaction.branch_id = $3)
         AND ($4::uuid IS NULL OR transaction.submitted_by_user_id = $4)`,
      [
        transactionId,
        scope.businessId,
        scope.branchId ?? null,
        scope.submittedByUserId ?? null,
      ],
    );
    return row ? this.map(row) : undefined;
  }

  async history(
    transactionId: string,
    scope: TransactionQueryScope,
  ): Promise<TransactionHistoryEntry[] | undefined> {
    const visible = await this.find(transactionId, scope);
    if (!visible) return undefined;
    const rows = await this.dao.many<HistoryRow>(
      `SELECT history.id, history.from_status, history.to_status,
              history.reason, history.transition_source, history.created_at
       FROM transaction_status_history history
       WHERE history.transaction_id = $1
       ORDER BY history.created_at ASC, history.id ASC`,
      [transactionId],
    );
    return rows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status ?? undefined,
      toStatus: row.to_status,
      reason: row.reason ?? undefined,
      transitionSource: row.transition_source,
      createdAt: row.created_at,
    }));
  }

  async verificationOutcomes(
    transactionId: string,
    scope: TransactionQueryScope,
  ) {
    const visible = await this.find(transactionId, scope);
    if (!visible) return undefined;
    const rows = await this.dao.many<VerificationOutcomeRow>(
      `SELECT attempt.id, attempt.attempt_type, attempt.attempt_number,
              attempt.result_status, attempt.requested_at,
              attempt.responded_at, attempt.response_time_ms,
              attempt.created_at
       FROM verification_attempts attempt
       WHERE attempt.transaction_id = $1
       ORDER BY attempt.attempt_number, attempt.created_at, attempt.id`,
      [transactionId],
    );
    return rows.map((row) => ({
      id: row.id,
      attemptType: row.attempt_type,
      attemptNumber: row.attempt_number,
      outcome: row.result_status,
      requestedAt: row.requested_at ?? undefined,
      respondedAt: row.responded_at ?? undefined,
      responseTimeMs: row.response_time_ms ?? undefined,
      failureCategory:
        row.result_status === VerificationAttemptResult.FAILED
          ? 'VERIFICATION_FAILED'
          : undefined,
      createdAt: row.created_at,
    }));
  }

  async receiptDecisions(
    transactionId: string,
    scope: TransactionQueryScope,
  ) {
    const visible = await this.find(transactionId, scope);
    if (!visible) return undefined;
    const rows = await this.dao.many<ReceiptDecisionRow>(
      `SELECT decision.id, decision.receipt_id, decision.decision,
              decision.reason_code, decision.created_at
       FROM receipt_match_decisions decision
       WHERE decision.transaction_id = $1
       ORDER BY decision.created_at ASC, decision.id ASC`,
      [transactionId],
    );
    return rows.map((row) => ({
      id: row.id,
      receiptId: row.receipt_id,
      decision: row.decision,
      reasonCode: row.reason_code ?? undefined,
      createdAt: row.created_at,
    }));
  }

  async receiptReviewSummary(
    scope: TransactionQueryScope,
    filters: { branchId?: string; dateFrom?: string; dateTo?: string },
  ) {
    const rows = await this.dao.many<ReceiptDecisionCountRow>(
      `SELECT decision.decision, decision.reason_code,
              count(*)::text AS decision_count
       FROM receipt_match_decisions decision
       JOIN customer_transactions transaction
         ON transaction.id = decision.transaction_id
       WHERE transaction.business_id = $1
         AND ($2::uuid IS NULL OR transaction.branch_id = $2)
         AND ($3::uuid IS NULL OR transaction.submitted_by_user_id = $3)
         AND ($4::date IS NULL OR decision.created_at >= $4::date)
         AND ($5::date IS NULL OR decision.created_at < $5::date + interval '1 day')
       GROUP BY decision.decision, decision.reason_code
       ORDER BY decision.decision, decision.reason_code`,
      [
        scope.businessId,
        scope.branchId ?? filters.branchId ?? null,
        scope.submittedByUserId ?? null,
        filters.dateFrom ?? null,
        filters.dateTo ?? null,
      ],
    );
    const reasons: Partial<Record<ReceiptReviewReasonCode, number>> = {};
    let matched = 0;
    let reviewRequired = 0;
    for (const row of rows) {
      const count = Number(row.decision_count);
      if (row.decision === 'MATCHED') matched += count;
      else {
        reviewRequired += count;
        if (row.reason_code) reasons[row.reason_code] = count;
      }
    }
    return {
      total: matched + reviewRequired,
      matched,
      reviewRequired,
      reasons,
    };
  }

  private selectSql(): string {
    return `SELECT transaction.id, transaction.business_id,
                   transaction.branch_id, transaction.submitted_by_user_id,
                   transaction.bank_id, transaction.transaction_reference,
                   transaction.amount::text, transaction.transaction_date::text,
                   transaction.transaction_time::text,
                   transaction.masked_receiver_account,
                   transaction.submission_method, transaction.current_status,
                   transaction.failure_reason, transaction.finalized_at,
                   transaction.created_at,
                   (SELECT count(*)::text FROM transaction_receipts receipt
                    WHERE receipt.transaction_id = transaction.id
                      AND receipt.archived_at IS NULL) AS receipt_count,
                   EXISTS (SELECT 1 FROM transaction_confirmations confirmation
                           WHERE confirmation.transaction_id = transaction.id)
                     AS confirmed,
                   transaction.ledger_entry_id IS NOT NULL AS financially_posted
            FROM customer_transactions transaction`;
  }

  private map(row: TransactionRow): TransactionSummary {
    const receiptCount = Number(row.receipt_count);
    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id ?? undefined,
      submittedByUserId: row.submitted_by_user_id,
      bankId: row.bank_id,
      transactionReference: row.transaction_reference,
      amount: row.amount,
      transactionDate: row.transaction_date,
      transactionTime: row.transaction_time,
      maskedReceiverAccount: row.masked_receiver_account ?? undefined,
      submissionMethod: row.submission_method,
      status: row.current_status,
      failureReason: row.failure_reason ?? undefined,
      finalizedAt: row.finalized_at ?? undefined,
      createdAt: row.created_at,
      receiptCount,
      hasReceipt: receiptCount > 0,
      confirmed: row.confirmed,
      financiallyPosted: row.financially_posted,
    };
  }
}
