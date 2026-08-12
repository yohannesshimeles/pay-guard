import { Injectable } from '@nestjs/common';
import { ReceiptReviewReasonCode } from '../qr-processing/receipt-match-decision.dao';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { TransactionQueryScope } from './transaction-query.dao';

export type ReceiptReviewCaseStatus = 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
export type ReceiptReviewResolutionCode =
  | 'EVIDENCE_REPLACED'
  | 'FALSE_POSITIVE'
  | 'INVALID_RECEIPT'
  | 'DUPLICATE_RECEIPT'
  | 'OTHER';

type CaseRow = {
  id: string;
  transaction_id: string;
  branch_id: string;
  transaction_reference: string;
  amount: string;
  transaction_date: string;
  receipt_id: string;
  file_name: string;
  mime_type: string;
  file_size_bytes: string;
  reason_code: ReceiptReviewReasonCode;
  status: ReceiptReviewCaseStatus;
  acknowledged_at: Date | null;
  acknowledged_by_user_id: string | null;
  acknowledgement_note: string | null;
  resolved_at: Date | null;
  resolved_by_user_id: string | null;
  resolution_code: ReceiptReviewResolutionCode | null;
  resolution_note: string | null;
  created_at: Date;
};

type CaseHistoryRow = {
  id: string;
  from_status: 'OPEN' | 'ACKNOWLEDGED' | null;
  to_status: ReceiptReviewCaseStatus;
  action_by_user_id: string | null;
  note: string | null;
  resolution_code: ReceiptReviewResolutionCode | null;
  created_at: Date;
};

type AgeingSummaryRow = {
  total_active: string;
  open_count: string;
  acknowledged_count: string;
  within_sla: string;
  overdue: string;
  oldest_active_created_at: Date | null;
  oldest_active_age_hours: string | null;
};

export class ReceiptReviewCaseNotFoundError extends Error {
  readonly name = 'ReceiptReviewCaseNotFoundError';
}
export class ReceiptReviewCaseConflictError extends Error {
  readonly name = 'ReceiptReviewCaseConflictError';
}

@Injectable()
export class ReceiptReviewCaseDao {
  constructor(private readonly dao: CentralDao) {}

  async list(
    scope: TransactionQueryScope,
    input: {
      status?: ReceiptReviewCaseStatus;
      reasonCode?: ReceiptReviewReasonCode;
      branchId?: string;
      limit: number;
      offset: number;
    },
  ) {
    const rows = await this.dao.many<CaseRow>(
      `${this.selectSql()}
       WHERE transaction.business_id = $1
         AND ($2::uuid IS NULL OR transaction.branch_id = $2)
         AND ($3::varchar IS NULL OR review_case.status = $3)
         AND ($4::varchar IS NULL OR decision.reason_code = $4)
       ORDER BY review_case.created_at DESC, review_case.id DESC
       LIMIT $5 OFFSET $6`,
      [
        scope.businessId,
        scope.branchId ?? input.branchId ?? null,
        input.status ?? null,
        input.reasonCode ?? null,
        input.limit,
        input.offset,
      ],
    );
    return rows.map((row) => this.map(row));
  }

  async history(scope: TransactionQueryScope, id: string) {
    const rows = await this.dao.many<CaseHistoryRow>(
      `SELECT history.id, history.from_status, history.to_status,
              history.action_by_user_id, history.note,
              history.resolution_code, history.created_at
       FROM receipt_review_case_history history
       JOIN receipt_review_cases review_case ON review_case.id = history.case_id
       JOIN customer_transactions transaction
         ON transaction.id = review_case.transaction_id
       WHERE review_case.id = $1 AND transaction.business_id = $2
         AND ($3::uuid IS NULL OR transaction.branch_id = $3)
       ORDER BY history.created_at, history.id`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    if (rows.length === 0) throw new ReceiptReviewCaseNotFoundError();
    return rows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status ?? undefined,
      toStatus: row.to_status,
      actionByUserId: row.action_by_user_id ?? undefined,
      note: row.note ?? undefined,
      resolutionCode: row.resolution_code ?? undefined,
      createdAt: row.created_at,
    }));
  }

  async ageingSummary(
    scope: TransactionQueryScope,
    input: {
      reasonCode?: ReceiptReviewReasonCode;
      branchId?: string;
      slaHours: number;
    },
  ) {
    const row = await this.dao.one<AgeingSummaryRow>(
      `SELECT
         count(*) FILTER (WHERE review_case.status IN ('OPEN','ACKNOWLEDGED'))::text
           AS total_active,
         count(*) FILTER (WHERE review_case.status = 'OPEN')::text AS open_count,
         count(*) FILTER (WHERE review_case.status = 'ACKNOWLEDGED')::text
           AS acknowledged_count,
         count(*) FILTER (
           WHERE review_case.status IN ('OPEN','ACKNOWLEDGED')
             AND review_case.created_at >=
               CURRENT_TIMESTAMP - make_interval(hours => $4)
         )::text AS within_sla,
         count(*) FILTER (
           WHERE review_case.status IN ('OPEN','ACKNOWLEDGED')
             AND review_case.created_at <
               CURRENT_TIMESTAMP - make_interval(hours => $4)
         )::text AS overdue,
         min(review_case.created_at) FILTER (
           WHERE review_case.status IN ('OPEN','ACKNOWLEDGED')
         ) AS oldest_active_created_at,
         (EXTRACT(EPOCH FROM (
           CURRENT_TIMESTAMP - min(review_case.created_at) FILTER (
             WHERE review_case.status IN ('OPEN','ACKNOWLEDGED')
           )
         )) / 3600)::text AS oldest_active_age_hours
       FROM receipt_review_cases review_case
       JOIN receipt_match_decisions decision
         ON decision.id = review_case.receipt_match_decision_id
       JOIN customer_transactions transaction
         ON transaction.id = review_case.transaction_id
       WHERE transaction.business_id = $1
         AND ($2::uuid IS NULL OR transaction.branch_id = $2)
         AND ($3::varchar IS NULL OR decision.reason_code = $3)`,
      [
        scope.businessId,
        scope.branchId ?? input.branchId ?? null,
        input.reasonCode ?? null,
        input.slaHours,
      ],
    );
    return {
      slaHours: input.slaHours,
      totalActive: Number(row.total_active),
      open: Number(row.open_count),
      acknowledged: Number(row.acknowledged_count),
      withinSla: Number(row.within_sla),
      overdue: Number(row.overdue),
      oldestActiveCreatedAt: row.oldest_active_created_at ?? undefined,
      oldestActiveAgeHours: row.oldest_active_age_hours === null
        ? undefined
        : Number(row.oldest_active_age_hours),
    };
  }

  async acknowledgeWithin(
    transaction: DaoTransaction,
    input: { id: string; scope: TransactionQueryScope; actorId: string; note: string },
  ) {
    const current = await this.requireWithin(transaction, input.id, input.scope);
    const note = input.note.trim();
    if (current.status !== 'OPEN') {
      if (
        current.status === 'ACKNOWLEDGED' &&
        current.acknowledged_by_user_id === input.actorId &&
        current.acknowledgement_note === note
      ) return this.map(current);
      throw new ReceiptReviewCaseConflictError();
    }
    const updated = await transaction.one<CaseRow>(
      `${this.updateSelectSql(`UPDATE receipt_review_cases
         SET status = 'ACKNOWLEDGED', acknowledged_at = now(),
             acknowledged_by_user_id = $2, acknowledgement_note = $3
         WHERE id = $1 RETURNING *`)} `,
      [input.id, input.actorId, note],
    );
    await this.recordHistory(transaction, {
      caseId: input.id, from: 'OPEN', to: 'ACKNOWLEDGED', actorId: input.actorId,
      note,
    });
    return this.map(updated);
  }

  async resolveWithin(
    transaction: DaoTransaction,
    input: {
      id: string;
      scope: TransactionQueryScope;
      actorId: string;
      resolutionCode: ReceiptReviewResolutionCode;
      note?: string;
    },
  ) {
    const current = await this.requireWithin(transaction, input.id, input.scope);
    const note = input.note?.trim() || undefined;
    if (current.status !== 'ACKNOWLEDGED') {
      if (
        current.status === 'RESOLVED' &&
        current.resolved_by_user_id === input.actorId &&
        current.resolution_code === input.resolutionCode &&
        (current.resolution_note ?? undefined) === note
      ) return this.map(current);
      throw new ReceiptReviewCaseConflictError();
    }
    const updated = await transaction.one<CaseRow>(
      `${this.updateSelectSql(`UPDATE receipt_review_cases
         SET status = 'RESOLVED', resolved_at = now(),
             resolved_by_user_id = $2, resolution_code = $3,
             resolution_note = $4
         WHERE id = $1 RETURNING *`)}`,
      [input.id, input.actorId, input.resolutionCode, note ?? null],
    );
    await this.recordHistory(transaction, {
      caseId: input.id, from: 'ACKNOWLEDGED', to: 'RESOLVED',
      actorId: input.actorId, note, resolutionCode: input.resolutionCode,
    });
    return this.map(updated);
  }

  private async requireWithin(
    transaction: DaoTransaction,
    id: string,
    scope: TransactionQueryScope,
  ): Promise<CaseRow> {
    const row = await transaction.optional<CaseRow>(
      `${this.selectSql()}
       WHERE review_case.id = $1 AND transaction.business_id = $2
         AND ($3::uuid IS NULL OR transaction.branch_id = $3)
       FOR UPDATE OF review_case`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    if (!row) throw new ReceiptReviewCaseNotFoundError();
    return row;
  }

  private recordHistory(
    transaction: DaoTransaction,
    input: {
      caseId: string; from: 'OPEN' | 'ACKNOWLEDGED';
      to: 'ACKNOWLEDGED' | 'RESOLVED'; actorId: string; note?: string;
      resolutionCode?: ReceiptReviewResolutionCode;
    },
  ) {
    return transaction.execute(
      `INSERT INTO receipt_review_case_history (
         case_id, from_status, to_status, action_by_user_id, note, resolution_code
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [input.caseId, input.from, input.to, input.actorId,
       input.note ?? null, input.resolutionCode ?? null],
    );
  }

  private updateSelectSql(update: string): string {
    return `WITH updated AS (${update})
            ${this.selectSql('changed', 'updated')}`;
  }

  private selectSql(
    caseAlias = 'review_case',
    source = 'receipt_review_cases',
  ): string {
    return `SELECT ${caseAlias}.id, ${caseAlias}.transaction_id,
                   transaction.branch_id, transaction.transaction_reference,
                   transaction.amount::text, transaction.transaction_date::text,
                   receipt.id AS receipt_id, receipt.file_name, receipt.mime_type,
                   receipt.file_size_bytes::text, decision.reason_code,
                   ${caseAlias}.status, ${caseAlias}.acknowledged_at,
                   ${caseAlias}.acknowledged_by_user_id,
                   ${caseAlias}.acknowledgement_note, ${caseAlias}.resolved_at,
                   ${caseAlias}.resolved_by_user_id, ${caseAlias}.resolution_code,
                   ${caseAlias}.resolution_note, ${caseAlias}.created_at
            FROM ${source} ${caseAlias}
            JOIN receipt_match_decisions decision
              ON decision.id = ${caseAlias}.receipt_match_decision_id
            JOIN transaction_receipts receipt ON receipt.id = decision.receipt_id
            JOIN customer_transactions transaction
              ON transaction.id = ${caseAlias}.transaction_id`;
  }

  private map(row: CaseRow) {
    return {
      id: row.id, transactionId: row.transaction_id, branchId: row.branch_id,
      transactionReference: row.transaction_reference, amount: row.amount,
      transactionDate: row.transaction_date, reasonCode: row.reason_code,
      receipt: { id: row.receipt_id, fileName: row.file_name,
        mimeType: row.mime_type, fileSizeBytes: Number(row.file_size_bytes) },
      status: row.status, createdAt: row.created_at,
      acknowledgedAt: row.acknowledged_at ?? undefined,
      acknowledgedByUserId: row.acknowledged_by_user_id ?? undefined,
      acknowledgementNote: row.acknowledgement_note ?? undefined,
      resolvedAt: row.resolved_at ?? undefined,
      resolvedByUserId: row.resolved_by_user_id ?? undefined,
      resolutionCode: row.resolution_code ?? undefined,
      resolutionNote: row.resolution_note ?? undefined,
    };
  }
}
