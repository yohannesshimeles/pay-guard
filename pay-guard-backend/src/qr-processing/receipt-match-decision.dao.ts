import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';

export type ReceiptReviewReasonCode =
  | 'NO_QR'
  | 'MULTIPLE_QR'
  | 'UNSUPPORTED_PROOF'
  | 'INCOMPLETE_QR'
  | 'UNSUPPORTED_BANK'
  | 'BANK_MISMATCH'
  | 'REFERENCE_MISMATCH'
  | 'AMOUNT_MISMATCH'
  | 'DATE_MISMATCH'
  | 'TIME_MISMATCH'
  | 'ACCOUNT_MISMATCH';

export type ReceiptMatchDecisionInput = Readonly<{
  receiptId: string;
  transactionId: string;
  decision: 'MATCHED' | 'REVIEW_REQUIRED';
  reasonCode?: ReceiptReviewReasonCode;
}>;

type DecisionRow = {
  id: string;
  receipt_id: string;
  transaction_id: string;
  decision: 'MATCHED' | 'REVIEW_REQUIRED';
  reason_code: ReceiptReviewReasonCode | null;
  created_at: Date;
};

export class ReceiptMatchDecisionConflictError extends Error {
  readonly name = 'ReceiptMatchDecisionConflictError';
}

@Injectable()
export class ReceiptMatchDecisionDao {
  constructor(private readonly dao: CentralDao) {}

  async record(input: ReceiptMatchDecisionInput) {
    this.assertInput(input);
    return this.dao.transaction((transaction) =>
      this.recordWithin(transaction, input),
    );
  }

  private async recordWithin(
    transaction: DaoTransaction,
    input: ReceiptMatchDecisionInput,
  ) {
    await transaction.execute(
      `INSERT INTO receipt_match_decisions (
         receipt_id, transaction_id, decision, reason_code
       ) VALUES ($1, $2, $3, $4)
       ON CONFLICT (receipt_id) DO NOTHING`,
      [
        input.receiptId,
        input.transactionId,
        input.decision,
        input.reasonCode ?? null,
      ],
    );
    const row = await transaction.one<DecisionRow>(
      `SELECT id, receipt_id, transaction_id, decision, reason_code, created_at
       FROM receipt_match_decisions WHERE receipt_id = $1`,
      [input.receiptId],
    );
    if (
      row.transaction_id !== input.transactionId ||
      row.decision !== input.decision ||
      (row.reason_code ?? undefined) !== input.reasonCode
    ) {
      throw new ReceiptMatchDecisionConflictError();
    }
    if (row.decision === 'REVIEW_REQUIRED') {
      const reviewCase = await transaction.one<{ id: string }>(
        `WITH inserted AS (
           INSERT INTO receipt_review_cases (
             receipt_match_decision_id, transaction_id
           ) VALUES ($1, $2)
           ON CONFLICT (receipt_match_decision_id) DO NOTHING
           RETURNING id
         )
         SELECT id FROM inserted
         UNION ALL
         SELECT id FROM receipt_review_cases
          WHERE receipt_match_decision_id = $1
         LIMIT 1`,
        [row.id, row.transaction_id],
      );
      await transaction.execute(
        `INSERT INTO receipt_review_case_history (
           case_id, from_status, to_status
         ) VALUES ($1, NULL, 'OPEN')
         ON CONFLICT (case_id, to_status) DO NOTHING`,
        [reviewCase.id],
      );
    }
    return {
      id: row.id,
      receiptId: row.receipt_id,
      transactionId: row.transaction_id,
      decision: row.decision,
      reasonCode: row.reason_code ?? undefined,
      createdAt: row.created_at,
    };
  }

  private assertInput(input: ReceiptMatchDecisionInput): void {
    if (
      (input.decision === 'MATCHED' && input.reasonCode) ||
      (input.decision === 'REVIEW_REQUIRED' && !input.reasonCode)
    ) {
      throw new Error('Receipt match decision reason is inconsistent');
    }
  }
}
