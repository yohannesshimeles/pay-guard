import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { CustomerTransactionStatus } from './enums/customer-transaction-status.enum';
import { VerificationAttemptResult } from './enums/verification-attempt-result.enum';
import { VerificationTransitionSource } from './enums/verification-transition-source.enum';
import { VerificationAttemptDao } from './verification-attempt.dao';
import { VerificationTransitionDao } from './verification-transition.dao';
import { LedgerDao } from '../ledger/ledger.dao';
import { LedgerEntryType } from '../ledger/ledger-entry-type.enum';

type MatchScopeRow = {
  transaction_id: string;
  business_id: string;
  branch_id: string;
  settlement_account_id: string;
  bank_id: string;
  transaction_reference: string;
  amount: string;
  work_assignment_id: string;
  submitted_by_user_id: string;
  account_suffix: string | null;
  account_status: string;
  tolerance_minutes: number | null;
  time_delta_seconds: number | null;
};

type ConfirmationRow = {
  id: string;
  transaction_id: string;
  verification_attempt_id: string;
};

export type PostVerifiedPayment = {
  attemptKey: string;
  providerRequestId: string;
  providerStatus: 'VERIFIED';
  requestedAt: Date;
  respondedAt: Date;
  providerBankId: string;
  transactionReference: string;
  amount: string;
  receiverAccountSuffix: string;
  providerTransactionAt: Date;
};

export type PostedVerifiedPayment = Readonly<{
  decision: 'VERIFIED' | 'DUPLICATE' | 'FAILED';
  replayed: boolean;
  transactionId: string;
  confirmationId?: string;
  ledgerEntryId?: string;
  originalTransactionId?: string;
  failureCode?: string;
}>;

@Injectable()
export class VerifiedPaymentPostingService {
  constructor(
    private readonly dao: CentralDao,
    private readonly attempts: VerificationAttemptDao,
    private readonly transitions: VerificationTransitionDao,
    private readonly ledger: LedgerDao,
  ) {}

  post(input: PostVerifiedPayment): Promise<PostedVerifiedPayment> {
    const responseTimeMs = this.validate(input);
    return this.dao.transaction(async (transaction) => {
      const attempt = await this.attempts.findByKeyWithin(
        transaction,
        input.attemptKey,
      );
      if (!attempt) throw new Error('Verification attempt was not found');

      const scope = await this.loadScope(
        transaction,
        attempt.transactionId,
        input,
      );
      const mismatch = this.matchFailure(scope, input);
      const existing = await transaction.optional<ConfirmationRow>(
        `SELECT id, transaction_id, verification_attempt_id
         FROM transaction_confirmations
         WHERE bank_id = $1
           AND transaction_reference = $2
           AND receiver_account_suffix = $3
         FOR UPDATE`,
        [
          input.providerBankId,
          input.transactionReference,
          input.receiverAccountSuffix,
        ],
      );
      const decision = mismatch
        ? VerificationAttemptResult.FAILED
        : existing && existing.transaction_id !== attempt.transactionId
          ? VerificationAttemptResult.DUPLICATE
          : VerificationAttemptResult.VERIFIED;
      const finalized = await this.attempts.finalizeWithin(transaction, {
        attemptKey: input.attemptKey,
        result: decision,
        providerRequestId: input.providerRequestId,
        providerStatus: input.providerStatus,
        requestedAt: input.requestedAt,
        respondedAt: input.respondedAt,
        responseTimeMs,
        errorCode: mismatch,
      });

      if (finalized.replayed) {
        return this.loadReplay(
          transaction,
          finalized.attempt.transactionId,
          finalized.attempt.id,
          decision,
          mismatch,
        );
      }
      if (
        decision === VerificationAttemptResult.VERIFIED &&
        existing?.transaction_id === attempt.transactionId
      ) {
        return this.loadReplay(
          transaction,
          attempt.transactionId,
          attempt.id,
          decision,
        );
      }
      if (decision === VerificationAttemptResult.FAILED) {
        await this.transition(
          transaction,
          attempt.transactionId,
          attempt.id,
          decision,
          mismatch,
        );
        return {
          decision: 'FAILED',
          replayed: false,
          transactionId: attempt.transactionId,
          failureCode: mismatch,
        };
      }
      if (decision === VerificationAttemptResult.DUPLICATE) {
        if (!existing || !attempt.creditTransactionId) {
          throw new Error('Duplicate verification identity is incomplete');
        }
        await transaction.execute(
          `INSERT INTO duplicate_transaction_attempts (
             transaction_id, original_transaction_id, detected_by,
             credit_transaction_id, verification_attempt_id
           ) VALUES ($1, $2, 'PAYGUARD', $3, $4)
           ON CONFLICT (verification_attempt_id) DO NOTHING`,
          [
            attempt.transactionId,
            existing.transaction_id,
            attempt.creditTransactionId,
            attempt.id,
          ],
        );
        await this.transition(
          transaction,
          attempt.transactionId,
          attempt.id,
          decision,
        );
        return {
          decision: 'DUPLICATE',
          replayed: false,
          transactionId: attempt.transactionId,
          confirmationId: existing.id,
          originalTransactionId: existing.transaction_id,
        };
      }

      const confirmation =
        existing ??
        (await transaction.one<ConfirmationRow>(
          `INSERT INTO transaction_confirmations (
           transaction_id, verification_attempt_id, business_id, branch_id,
           settlement_account_id, bank_id, transaction_reference,
           receiver_account_suffix, amount, provider_transaction_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         RETURNING id, transaction_id, verification_attempt_id`,
          [
            attempt.transactionId,
            attempt.id,
            scope.business_id,
            scope.branch_id,
            scope.settlement_account_id,
            scope.bank_id,
            input.transactionReference,
            input.receiverAccountSuffix,
            input.amount,
            input.providerTransactionAt,
          ],
        ));
      const audit = await transaction.one<{ id: string }>(
        `INSERT INTO audit_logs (
           business_id, branch_id, action_type, record_type, record_id,
           new_value, reason, result
         ) VALUES (
           $1,$2,'VERIFIED_PAYMENT_POSTED','TRANSACTION_CONFIRMATION',$3,
           jsonb_build_object('transactionId',$4::text,'amount',$5::text),
           'VERIFYET_MATCHED_PAYMENT','SUCCESS'
         ) RETURNING id`,
        [
          scope.business_id, scope.branch_id, confirmation.id,
          attempt.transactionId, input.amount,
        ],
      );
      const posted = await this.ledger.postWithin(transaction, {
        businessId: scope.business_id,
        branchId: scope.branch_id,
        settlementAccountId: scope.settlement_account_id,
        entryType: LedgerEntryType.VERIFIED_DEPOSIT,
        amount: input.amount,
        actualTransactionAt: input.providerTransactionAt,
        sourceRecordType: 'TRANSACTION_CONFIRMATION',
        sourceRecordId: confirmation.id,
        description: 'VERIFIED_CUSTOMER_PAYMENT',
        createdByUserId: scope.submitted_by_user_id,
        workAssignmentId: scope.work_assignment_id,
        auditLogId: audit.id,
        idempotencyKey: `ledger:verified:${confirmation.id}`,
      });
      await transaction.one(
        `UPDATE customer_transactions
         SET ledger_entry_id = $2, verifyet_request_id = $3
         WHERE id = $1 AND ledger_entry_id IS NULL
         RETURNING id`,
        [attempt.transactionId, posted.entry.id, input.providerRequestId],
      );
      await this.transition(
        transaction,
        attempt.transactionId,
        attempt.id,
        decision,
      );
      return {
        decision: 'VERIFIED',
        replayed: false,
        transactionId: attempt.transactionId,
        confirmationId: confirmation.id,
        ledgerEntryId: posted.entry.id,
      };
    });
  }

  private async loadScope(
    transaction: DaoTransaction,
    transactionId: string,
    input: PostVerifiedPayment,
  ): Promise<MatchScopeRow> {
    return transaction.one<MatchScopeRow>(
      `SELECT customer_transaction.id AS transaction_id,
              customer_transaction.business_id,
              customer_transaction.branch_id,
              customer_transaction.settlement_account_id,
              customer_transaction.bank_id,
              customer_transaction.transaction_reference,
              customer_transaction.amount::text,
              customer_transaction.work_assignment_id,
              customer_transaction.submitted_by_user_id,
              account.normalized_account_suffix AS account_suffix,
              account.status AS account_status,
              setting.time_tolerance_minutes AS tolerance_minutes,
              EXTRACT(EPOCH FROM (
                $2::timestamptz -
                ((customer_transaction.transaction_date + customer_transaction.transaction_time)
                  AT TIME ZONE setting.timezone)
              ))::double precision AS time_delta_seconds
       FROM customer_transactions customer_transaction
       JOIN settlement_accounts account
         ON account.id = customer_transaction.settlement_account_id
       LEFT JOIN branch_verification_settings setting
         ON setting.branch_id = customer_transaction.branch_id
       WHERE customer_transaction.id = $1
       FOR UPDATE OF customer_transaction, account`,
      [transactionId, input.providerTransactionAt],
    );
  }

  private matchFailure(
    scope: MatchScopeRow,
    input: PostVerifiedPayment,
  ): string | undefined {
    if (scope.tolerance_minutes === null || scope.time_delta_seconds === null) {
      return 'MATCH_CONFIGURATION_MISSING';
    }
    if (scope.account_status !== 'ACTIVE' || !scope.account_suffix) {
      return 'RECEIVER_ACCOUNT_INACTIVE';
    }
    if (scope.bank_id !== input.providerBankId) return 'BANK_MISMATCH';
    if (scope.transaction_reference !== input.transactionReference) {
      return 'REFERENCE_MISMATCH';
    }
    if (scope.amount !== input.amount) return 'AMOUNT_MISMATCH';
    if (scope.account_suffix !== input.receiverAccountSuffix) {
      return 'RECEIVER_MISMATCH';
    }
    if (Math.abs(scope.time_delta_seconds) > scope.tolerance_minutes * 60) {
      return 'TIME_TOLERANCE_EXCEEDED';
    }
    return undefined;
  }

  private async transition(
    transaction: DaoTransaction,
    transactionId: string,
    attemptId: string,
    result:
      | VerificationAttemptResult.VERIFIED
      | VerificationAttemptResult.DUPLICATE
      | VerificationAttemptResult.FAILED,
    mismatch?: string,
  ): Promise<void> {
    const status =
      result === VerificationAttemptResult.VERIFIED
        ? CustomerTransactionStatus.VERIFIED
        : result === VerificationAttemptResult.DUPLICATE
          ? CustomerTransactionStatus.DUPLICATE
          : CustomerTransactionStatus.FAILED;
    await this.transitions.transitionWithin(transaction, {
      transactionId,
      toStatus: status,
      source: VerificationTransitionSource.SYSTEM,
      reasonCode: mismatch ?? `MATCHED_${result}`,
      verificationAttemptId: attemptId,
    });
  }

  private async loadReplay(
    transaction: DaoTransaction,
    transactionId: string,
    attemptId: string,
    decision:
      | VerificationAttemptResult.VERIFIED
      | VerificationAttemptResult.DUPLICATE
      | VerificationAttemptResult.FAILED,
    mismatch?: string,
  ): Promise<PostedVerifiedPayment> {
    const row = await transaction.one<{
      confirmation_id: string | null;
      ledger_entry_id: string | null;
      original_transaction_id: string | null;
    }>(
      `SELECT confirmation.id AS confirmation_id,
              customer_transaction.ledger_entry_id,
              duplicate.original_transaction_id
       FROM customer_transactions customer_transaction
       LEFT JOIN transaction_confirmations confirmation
         ON confirmation.transaction_id = customer_transaction.id
       LEFT JOIN duplicate_transaction_attempts duplicate
         ON duplicate.transaction_id = customer_transaction.id
        AND duplicate.verification_attempt_id = $2
       WHERE customer_transaction.id = $1`,
      [transactionId, attemptId],
    );
    return {
      decision,
      replayed: true,
      transactionId,
      confirmationId: row.confirmation_id ?? undefined,
      ledgerEntryId: row.ledger_entry_id ?? undefined,
      originalTransactionId: row.original_transaction_id ?? undefined,
      failureCode: mismatch,
    };
  }

  private validate(input: PostVerifiedPayment): number {
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(input.providerRequestId) ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
        input.providerBankId,
      ) ||
      !/^[A-Za-z0-9._:/-]{1,180}$/u.test(input.transactionReference) ||
      !/^(?:0|[1-9][0-9]{0,15})\.[0-9]{2}$/u.test(input.amount) ||
      !/^[A-Z0-9]{4,32}$/u.test(input.receiverAccountSuffix) ||
      Number.isNaN(input.requestedAt.getTime()) ||
      Number.isNaN(input.respondedAt.getTime()) ||
      Number.isNaN(input.providerTransactionAt.getTime()) ||
      input.respondedAt < input.requestedAt
    ) {
      throw new Error('Verified payment input is invalid');
    }
    const responseTimeMs =
      input.respondedAt.getTime() - input.requestedAt.getTime();
    if (
      !Number.isSafeInteger(responseTimeMs) ||
      responseTimeMs > 2_147_483_647
    ) {
      throw new Error('Verification provider response time is invalid');
    }
    return responseTimeMs;
  }
}
