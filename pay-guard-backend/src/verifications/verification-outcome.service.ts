import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { VerificationAttemptEntity } from './entities/verification-attempt.entity';
import { CustomerTransactionStatus } from './enums/customer-transaction-status.enum';
import { VerificationAttemptResult } from './enums/verification-attempt-result.enum';
import { VerificationAttemptType } from './enums/verification-attempt-type.enum';
import { VerificationTransitionSource } from './enums/verification-transition-source.enum';
import { PendingRecheckDao } from './pending-recheck.dao';
import { VerificationAttemptDao } from './verification-attempt.dao';
import { VerificationTransitionDao } from './verification-transition.dao';

export type RecordVerificationOutcome = {
  attemptKey: string;
  result: VerificationAttemptResult;
  providerRequestId: string;
  providerStatus: string;
  requestedAt: Date;
  respondedAt: Date;
  errorCode?: string;
  nextRecheckAt?: Date;
};

export type RecordedVerificationOutcome = Readonly<{
  attempt: VerificationAttemptEntity;
  transactionStatus: CustomerTransactionStatus;
  replayed: boolean;
  nextRecheckNumber?: number;
  recheckLimitReached: boolean;
}>;

@Injectable()
export class VerificationOutcomeService {
  constructor(
    private readonly dao: CentralDao,
    private readonly attempts: VerificationAttemptDao,
    private readonly transitions: VerificationTransitionDao,
    private readonly rechecks: PendingRecheckDao,
  ) {}

  record(
    input: RecordVerificationOutcome,
  ): Promise<RecordedVerificationOutcome> {
    const normalized = this.validate(input);
    return this.dao.transaction(async (transaction) => {
      const finalized = await this.attempts.finalizeWithin(transaction, {
        attemptKey: normalized.attemptKey,
        result: normalized.result,
        providerRequestId: normalized.providerRequestId,
        providerStatus: normalized.providerStatus,
        requestedAt: normalized.requestedAt,
        respondedAt: normalized.respondedAt,
        responseTimeMs: normalized.responseTimeMs,
        errorCode: normalized.errorCode,
      });
      const transactionStatus = this.toTransactionStatus(normalized.result);
      const nextRecheckNumber =
        normalized.result === VerificationAttemptResult.PENDING
          ? await this.resolveNextRecheckNumber(transaction, finalized.attempt)
          : undefined;
      const recheckLimitReached =
        normalized.result === VerificationAttemptResult.PENDING &&
        nextRecheckNumber === undefined;
      if (recheckLimitReached && input.nextRecheckAt !== undefined) {
        throw new Error('Pending recheck limit has already been reached');
      }

      if (!finalized.replayed) {
        await this.transitions.transitionWithin(transaction, {
          transactionId: finalized.attempt.transactionId,
          toStatus: transactionStatus,
          source: VerificationTransitionSource.VERIFYET,
          reasonCode: this.reasonCode(normalized),
          verificationAttemptId: finalized.attempt.id,
        });
        if (nextRecheckNumber !== undefined) {
          if (!input.nextRecheckAt) {
            throw new Error(
              'Pending outcome requires an explicit recheck schedule',
            );
          }
          await this.rechecks.scheduleWithin(transaction, {
            transactionId: finalized.attempt.transactionId,
            recheckNumber: nextRecheckNumber,
            scheduledAt: input.nextRecheckAt,
          });
        }
      }

      return {
        attempt: finalized.attempt,
        transactionStatus,
        replayed: finalized.replayed,
        nextRecheckNumber,
        recheckLimitReached,
      };
    });
  }

  private validate(
    input: RecordVerificationOutcome,
  ): RecordVerificationOutcome & {
    result:
      VerificationAttemptResult.PENDING | VerificationAttemptResult.FAILED;
    responseTimeMs: number;
  } {
    if (input.result === VerificationAttemptResult.QUEUED) {
      throw new Error('Queued is not a provider outcome');
    }
    if (
      input.result === VerificationAttemptResult.VERIFIED ||
      input.result === VerificationAttemptResult.DUPLICATE
    ) {
      throw new Error(
        'Verification financial outcome requires matching and ledger posting',
      );
    }
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(input.providerRequestId) ||
      !/^[A-Z0-9_]{1,24}$/u.test(input.providerStatus) ||
      (input.errorCode !== undefined &&
        !/^[A-Z0-9_]{1,80}$/u.test(input.errorCode)) ||
      Number.isNaN(input.requestedAt.getTime()) ||
      Number.isNaN(input.respondedAt.getTime()) ||
      input.respondedAt < input.requestedAt ||
      (input.nextRecheckAt !== undefined &&
        Number.isNaN(input.nextRecheckAt.getTime()))
    ) {
      throw new Error('Verification provider outcome is invalid');
    }
    if (
      input.result !== VerificationAttemptResult.PENDING &&
      input.nextRecheckAt !== undefined
    ) {
      throw new Error('Only a pending outcome can schedule a recheck');
    }
    const responseTimeMs =
      input.respondedAt.getTime() - input.requestedAt.getTime();
    if (
      !Number.isSafeInteger(responseTimeMs) ||
      responseTimeMs > 2_147_483_647
    ) {
      throw new Error('Verification provider response time is invalid');
    }
    return { ...input, result: input.result, responseTimeMs };
  }

  private async resolveNextRecheckNumber(
    transaction: DaoTransaction,
    attempt: VerificationAttemptEntity,
  ): Promise<number | undefined> {
    if (attempt.attemptType === VerificationAttemptType.INITIAL) return 1;
    if (attempt.attemptType !== VerificationAttemptType.RECHECK) {
      throw new Error('Unsupported pending verification attempt type');
    }
    const current = await transaction.one<{ recheck_number: number }>(
      `SELECT recheck_number
       FROM pending_rechecks
       WHERE verification_attempt_id = $1
         AND status IN ('CLAIMED','COMPLETED')
       FOR UPDATE`,
      [attempt.id],
    );
    return current.recheck_number < 3 ? current.recheck_number + 1 : undefined;
  }

  private toTransactionStatus(
    result:
      VerificationAttemptResult.PENDING | VerificationAttemptResult.FAILED,
  ): CustomerTransactionStatus {
    switch (result) {
      case VerificationAttemptResult.PENDING:
        return CustomerTransactionStatus.PENDING;
      case VerificationAttemptResult.FAILED:
        return CustomerTransactionStatus.FAILED;
    }
  }

  private reasonCode(input: RecordVerificationOutcome): string {
    if (input.result === VerificationAttemptResult.FAILED) {
      return input.errorCode ?? 'PROVIDER_FAILED';
    }
    return `PROVIDER_${input.result}`;
  }
}
