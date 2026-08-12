import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { CreateTransactionDto } from './dto/create-transaction.dto';

type SubmissionRow = {
  id: string;
  business_id: string;
  branch_id: string;
  submitted_by_user_id: string;
  settlement_account_id: string;
  bank_id: string;
  transaction_reference: string;
  amount: string;
  transaction_date: string;
  transaction_time: string;
  sender_name: string | null;
  receiver_name: string | null;
  masked_receiver_account: string | null;
  submission_method: 'QR_SCAN' | 'DOCUMENT_SCAN' | 'MANUAL';
  current_status: string;
  submission_key: string;
  created_at: Date;
};

export type CreateTransactionSubmission = CreateTransactionDto & {
  businessId: string;
  branchId: string;
  workAssignmentId: string;
  submittedByUserId: string;
};

export class TransactionSubmissionScopeError extends Error {
  readonly name = 'TransactionSubmissionScopeError';
}

export class TransactionSubmissionConflictError extends Error {
  readonly name = 'TransactionSubmissionConflictError';
}

@Injectable()
export class TransactionSubmissionDao {
  constructor(private readonly dao: CentralDao) {}

  create(input: CreateTransactionSubmission) {
    return this.dao.transaction((transaction) =>
      this.createWithin(transaction, input),
    );
  }

  private async createWithin(
    transaction: DaoTransaction,
    input: CreateTransactionSubmission,
  ) {
    const existing = await transaction.optional<SubmissionRow>(
      `${this.selectSql()}
       WHERE submitted.business_id = $1
         AND submitted.submitted_by_user_id = $2
         AND submitted.submission_key = $3`,
      [input.businessId, input.submittedByUserId, input.idempotencyKey],
    );
    if (existing) {
      this.assertReplay(existing, input);
      return { transaction: this.present(existing), replayed: true };
    }

    const inserted = await transaction.optional<SubmissionRow>(
      `INSERT INTO customer_transactions (
         business_id, branch_id, work_assignment_id, submitted_by_user_id,
         settlement_account_id, bank_id, transaction_reference, amount,
         transaction_date, transaction_time, sender_name, receiver_name,
         masked_receiver_account, submission_method, submission_key
       )
       SELECT $1, $2, assignment.id, $4, account.id, $6, $7, $8::numeric,
              $9::date, $10::time, $11, $12, $13, $14, $15
       FROM user_work_assignments assignment
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = assignment.membership_role_id
       JOIN business_user_memberships membership
         ON membership.id = role_assignment.membership_id
       JOIN businesses business ON business.id = $1
       JOIN branches branch ON branch.id = $2 AND branch.business_id = $1
       JOIN settlement_accounts account
         ON account.id = $5 AND account.business_id = $1
        AND account.branch_id = $2 AND account.bank_id = $6
       WHERE assignment.id = $3 AND assignment.business_id = $1
         AND assignment.branch_id = $2 AND assignment.status = 'ACTIVE'
         AND membership.user_id = $4 AND membership.business_id = $1
         AND membership.status = 'ACTIVE' AND role_assignment.status = 'ACTIVE'
         AND business.status = 'ACTIVE' AND branch.status = 'ACTIVE'
         AND account.status = 'ACTIVE'
       ON CONFLICT (business_id, submitted_by_user_id, submission_key)
         WHERE submission_key IS NOT NULL DO NOTHING
       RETURNING id, business_id, branch_id, submitted_by_user_id,
                 settlement_account_id, bank_id, transaction_reference,
                 amount::text, transaction_date::text, transaction_time::text,
                 sender_name, receiver_name, masked_receiver_account,
                 submission_method, current_status, submission_key, created_at`,
      [
        input.businessId,
        input.branchId,
        input.workAssignmentId,
        input.submittedByUserId,
        input.settlementAccountId,
        input.bankId,
        input.transactionReference,
        input.amount,
        input.transactionDate,
        input.transactionTime,
        input.senderName ?? null,
        input.receiverName ?? null,
        input.maskedReceiverAccount ?? null,
        input.submissionMethod,
        input.idempotencyKey,
      ],
    );
    if (!inserted) {
      const concurrent = await transaction.optional<SubmissionRow>(
        `${this.selectSql()}
         WHERE submitted.business_id = $1
           AND submitted.submitted_by_user_id = $2
           AND submitted.submission_key = $3`,
        [input.businessId, input.submittedByUserId, input.idempotencyKey],
      );
      if (!concurrent) throw new TransactionSubmissionScopeError();
      this.assertReplay(concurrent, input);
      return { transaction: this.present(concurrent), replayed: true };
    }
    await transaction.execute(
      `INSERT INTO transaction_status_history (
         transaction_id, from_status, to_status, reason,
         changed_by_user_id, transition_source
       ) VALUES ($1, NULL, 'PROCESSING', 'TRANSACTION_SUBMITTED', $2, 'SYSTEM')`,
      [inserted.id, input.submittedByUserId],
    );
    return { transaction: this.present(inserted), replayed: false };
  }

  private selectSql(): string {
    return `SELECT submitted.id, submitted.business_id, submitted.branch_id,
                   submitted.submitted_by_user_id,
                   submitted.settlement_account_id, submitted.bank_id,
                   submitted.transaction_reference, submitted.amount::text,
                   submitted.transaction_date::text,
                   submitted.transaction_time::text,
                   submitted.sender_name, submitted.receiver_name,
                   submitted.masked_receiver_account,
                   submitted.submission_method, submitted.current_status,
                   submitted.submission_key, submitted.created_at
            FROM customer_transactions submitted`;
  }

  private assertReplay(row: SubmissionRow, input: CreateTransactionSubmission) {
    if (
      row.branch_id !== input.branchId ||
      row.settlement_account_id !== input.settlementAccountId ||
      row.bank_id !== input.bankId ||
      row.transaction_reference !== input.transactionReference ||
      row.amount !== this.canonicalAmount(input.amount) ||
      row.transaction_date !== input.transactionDate ||
      !row.transaction_time.startsWith(input.transactionTime) ||
      (row.sender_name ?? undefined) !== input.senderName ||
      (row.receiver_name ?? undefined) !== input.receiverName ||
      (row.masked_receiver_account ?? undefined) !==
        input.maskedReceiverAccount ||
      row.submission_method !== input.submissionMethod
    ) {
      throw new TransactionSubmissionConflictError();
    }
  }

  private canonicalAmount(value: string): string {
    const [whole, fraction = ''] = value.split('.');
    return `${BigInt(whole).toString()}.${fraction.padEnd(2, '0')}`;
  }

  private present(row: SubmissionRow) {
    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      submittedByUserId: row.submitted_by_user_id,
      settlementAccountId: row.settlement_account_id,
      bankId: row.bank_id,
      transactionReference: row.transaction_reference,
      amount: row.amount,
      transactionDate: row.transaction_date,
      transactionTime: row.transaction_time,
      submissionMethod: row.submission_method,
      status: row.current_status,
      createdAt: row.created_at,
    };
  }
}
