import { Injectable } from '@nestjs/common';
import { DaoTransaction } from '../database/central.dao';
import { VerificationAttemptEntity } from './entities/verification-attempt.entity';
import { VerificationAttemptResult } from './enums/verification-attempt-result.enum';
import { VerificationAttemptType } from './enums/verification-attempt-type.enum';

type VerificationAttemptRow = {
  id: string;
  transaction_id: string;
  business_id: string;
  branch_id: string;
  attempt_key: string;
  attempt_type: VerificationAttemptType;
  attempt_number: number;
  result_status: VerificationAttemptResult;
  credit_transaction_id: string | null;
  provider_request_id: string | null;
  provider_status: string | null;
  requested_at: Date | null;
  responded_at: Date | null;
  response_time_ms: number | null;
  error_code: string | null;
  created_at: Date;
};

export type ReserveVerificationAttempt = {
  transactionId: string;
  businessId: string;
  branchId: string;
  attemptKey: string;
  attemptType: VerificationAttemptType;
  creditTransactionId: string;
};

export type ReservedVerificationAttempt = Readonly<{
  attempt: VerificationAttemptEntity;
  replayed: boolean;
}>;

export type FinalizeVerificationAttempt = {
  attemptKey: string;
  result: Exclude<VerificationAttemptResult, VerificationAttemptResult.QUEUED>;
  providerRequestId: string;
  providerStatus: string;
  requestedAt: Date;
  respondedAt: Date;
  responseTimeMs: number;
  errorCode?: string;
};

export type FinalizedVerificationAttempt = Readonly<{
  attempt: VerificationAttemptEntity;
  replayed: boolean;
}>;

export class VerificationAttemptIdempotencyConflictError extends Error {
  readonly name = 'VerificationAttemptIdempotencyConflictError';

  constructor() {
    super('Verification attempt key is already bound to another request');
  }
}

export class VerificationAttemptOutcomeConflictError extends Error {
  readonly name = 'VerificationAttemptOutcomeConflictError';

  constructor() {
    super('Verification attempt already has another provider outcome');
  }
}

@Injectable()
export class VerificationAttemptDao {
  async findByKeyWithin(
    transaction: DaoTransaction,
    attemptKey: string,
  ): Promise<VerificationAttemptEntity | undefined> {
    this.validateAttemptKey(attemptKey);
    const row = await transaction.optional<VerificationAttemptRow>(
      `${this.selectAttemptSql()}
       WHERE attempt.attempt_key = $1
       FOR UPDATE OF attempt`,
      [attemptKey],
    );
    return row ? this.map(row) : undefined;
  }

  async reserveWithin(
    transaction: DaoTransaction,
    input: ReserveVerificationAttempt,
  ): Promise<ReservedVerificationAttempt> {
    this.validateAttemptKey(input.attemptKey);
    const inserted = await transaction.optional<VerificationAttemptRow>(
      `INSERT INTO verification_attempts (
         transaction_id, business_id, attempt_key, attempt_type,
         attempt_number, result_status, credit_transaction_id
       )
       SELECT $1, $2, $3, $4,
              COALESCE(MAX(attempt_number), 0) + 1, 'QUEUED', $5
       FROM verification_attempts
       WHERE transaction_id = $1
       ON CONFLICT (attempt_key) DO NOTHING
       RETURNING id, transaction_id, business_id,
                 (SELECT branch_id FROM customer_transactions WHERE id = $1) AS branch_id,
                 attempt_key, attempt_type, attempt_number, result_status,
                 credit_transaction_id, requested_at, responded_at,
                 response_time_ms, error_code, created_at`,
      [
        input.transactionId,
        input.businessId,
        input.attemptKey,
        input.attemptType,
        input.creditTransactionId,
      ],
    );

    const attempt = inserted
      ? this.map(inserted)
      : await this.requireByKeyWithin(transaction, input.attemptKey);
    this.assertBinding(attempt, input);
    return { attempt, replayed: inserted === undefined };
  }

  async finalizeWithin(
    transaction: DaoTransaction,
    input: FinalizeVerificationAttempt,
  ): Promise<FinalizedVerificationAttempt> {
    const current = await this.findByKeyWithin(transaction, input.attemptKey);
    if (!current) throw new Error('Verification attempt was not found');
    if (current.result !== VerificationAttemptResult.QUEUED) {
      this.assertOutcome(current, input);
      return { attempt: current, replayed: true };
    }

    const row = await transaction.one<VerificationAttemptRow>(
      `UPDATE verification_attempts attempt
       SET result_status = $2,
           provider_request_id = $3,
           provider_status = $4,
           requested_at = $5,
           responded_at = $6,
           response_time_ms = $7,
           error_code = $8
       WHERE attempt.id = $1
         AND attempt.result_status = 'QUEUED'
       RETURNING attempt.id, attempt.transaction_id, attempt.business_id,
                 (SELECT branch_id FROM customer_transactions WHERE id = attempt.transaction_id) AS branch_id,
                 attempt.attempt_key, attempt.attempt_type,
                 attempt.attempt_number, attempt.result_status,
                 attempt.credit_transaction_id, attempt.provider_request_id,
                 attempt.provider_status, attempt.requested_at,
                 attempt.responded_at, attempt.response_time_ms,
                 attempt.error_code, attempt.created_at`,
      [
        current.id,
        input.result,
        input.providerRequestId,
        input.providerStatus,
        input.requestedAt,
        input.respondedAt,
        input.responseTimeMs,
        input.errorCode ?? null,
      ],
    );
    return { attempt: this.map(row), replayed: false };
  }

  assertBinding(
    attempt: VerificationAttemptEntity,
    input: ReserveVerificationAttempt,
  ): void {
    if (
      attempt.transactionId !== input.transactionId ||
      attempt.businessId !== input.businessId ||
      attempt.branchId !== input.branchId ||
      attempt.attemptType !== input.attemptType ||
      attempt.creditTransactionId !== input.creditTransactionId
    ) {
      throw new VerificationAttemptIdempotencyConflictError();
    }
  }

  private assertOutcome(
    attempt: VerificationAttemptEntity,
    input: FinalizeVerificationAttempt,
  ): void {
    if (
      attempt.result !== input.result ||
      attempt.providerRequestId !== input.providerRequestId ||
      attempt.providerStatus !== input.providerStatus ||
      attempt.requestedAt?.getTime() !== input.requestedAt.getTime() ||
      attempt.respondedAt?.getTime() !== input.respondedAt.getTime() ||
      attempt.responseTimeMs !== input.responseTimeMs ||
      attempt.errorCode !== input.errorCode
    ) {
      throw new VerificationAttemptOutcomeConflictError();
    }
  }

  private async requireByKeyWithin(
    transaction: DaoTransaction,
    attemptKey: string,
  ): Promise<VerificationAttemptEntity> {
    const attempt = await this.findByKeyWithin(transaction, attemptKey);
    if (!attempt) {
      throw new Error('Verification attempt conflict could not be resolved');
    }
    return attempt;
  }

  private validateAttemptKey(attemptKey: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u.test(attemptKey)) {
      throw new Error('Verification attempt key is invalid');
    }
  }

  private selectAttemptSql(): string {
    return `SELECT attempt.id, attempt.transaction_id, attempt.business_id,
                   customer_transaction.branch_id, attempt.attempt_key,
                   attempt.attempt_type, attempt.attempt_number,
                   attempt.result_status, attempt.credit_transaction_id,
                   attempt.provider_request_id, attempt.provider_status,
                   attempt.requested_at, attempt.responded_at,
                   attempt.response_time_ms, attempt.error_code,
                   attempt.created_at
            FROM verification_attempts attempt
            JOIN customer_transactions customer_transaction
              ON customer_transaction.id = attempt.transaction_id`;
  }

  private map(row: VerificationAttemptRow): VerificationAttemptEntity {
    return new VerificationAttemptEntity({
      id: row.id,
      transactionId: row.transaction_id,
      businessId: row.business_id,
      branchId: row.branch_id,
      attemptKey: row.attempt_key,
      attemptType: row.attempt_type,
      attemptNumber: row.attempt_number,
      result: row.result_status,
      creditTransactionId: row.credit_transaction_id ?? undefined,
      providerRequestId: row.provider_request_id ?? undefined,
      providerStatus: row.provider_status ?? undefined,
      requestedAt: row.requested_at ?? undefined,
      respondedAt: row.responded_at ?? undefined,
      responseTimeMs: row.response_time_ms ?? undefined,
      errorCode: row.error_code ?? undefined,
      createdAt: row.created_at,
    });
  }
}
