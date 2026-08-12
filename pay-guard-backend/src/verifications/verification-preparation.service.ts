import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { VerificationAttemptEntity } from './entities/verification-attempt.entity';
import { CustomerTransactionStatus } from './enums/customer-transaction-status.enum';
import { VerificationAttemptType } from './enums/verification-attempt-type.enum';
import { VerificationTransitionSource } from './enums/verification-transition-source.enum';
import {
  ReserveVerificationAttempt,
  VerificationAttemptDao,
} from './verification-attempt.dao';
import { VerificationCreditEligibilityDao } from './verification-credit-eligibility.dao';
import { VerificationTransitionDao } from './verification-transition.dao';

export type PrepareVerification = Omit<
  ReserveVerificationAttempt,
  'creditTransactionId'
>;

export type VerificationPreparation =
  | Readonly<{
      decision: 'PREPARED';
      attempt: VerificationAttemptEntity;
      attemptReplayed: boolean;
      creditConsumed: boolean;
    }>
  | Readonly<{
      decision: 'WAITING_CREDITS' | 'PAUSED_BRANCH';
      statusChanged: boolean;
    }>;

@Injectable()
export class VerificationPreparationService {
  constructor(
    private readonly dao: CentralDao,
    private readonly credits: VerificationCreditEligibilityDao,
    private readonly attempts: VerificationAttemptDao,
    private readonly transitions: VerificationTransitionDao,
  ) {}

  prepare(input: PrepareVerification): Promise<VerificationPreparation> {
    return this.dao.transaction((transaction) =>
      this.prepareWithin(transaction, input),
    );
  }

  private async prepareWithin(
    transaction: DaoTransaction,
    input: PrepareVerification,
  ): Promise<VerificationPreparation> {
    const existingAttempt = await this.attempts.findByKeyWithin(
      transaction,
      input.attemptKey,
    );
    if (existingAttempt) {
      if (!existingAttempt.creditTransactionId) {
        throw new Error('Verification attempt is missing its credit event');
      }
      this.attempts.assertBinding(existingAttempt, {
        ...input,
        creditTransactionId: existingAttempt.creditTransactionId,
      });
      return {
        decision: 'PREPARED',
        attempt: existingAttempt,
        attemptReplayed: true,
        creditConsumed: false,
      };
    }

    const eligibility = await this.credits.resolveWithin(transaction, input);
    if (eligibility.decision !== 'ELIGIBLE') {
      const targetStatus =
        eligibility.decision === 'WAITING_CREDITS'
          ? CustomerTransactionStatus.WAITING_CREDITS
          : CustomerTransactionStatus.PAUSED_BRANCH;
      const statusChanged = eligibility.transactionStatus !== targetStatus;
      if (statusChanged) {
        await this.transitions.transitionWithin(transaction, {
          transactionId: input.transactionId,
          toStatus: targetStatus,
          source:
            targetStatus === CustomerTransactionStatus.WAITING_CREDITS
              ? VerificationTransitionSource.CREDIT_POLICY
              : VerificationTransitionSource.SYSTEM,
          reasonCode:
            targetStatus === CustomerTransactionStatus.WAITING_CREDITS
              ? 'CREDITS_EXHAUSTED'
              : 'BRANCH_NOT_ACTIVE',
        });
      }
      return { decision: eligibility.decision, statusChanged };
    }
    if (!eligibility.creditTransactionId) {
      throw new Error('Eligible verification is missing its credit event');
    }

    const reserved = await this.attempts.reserveWithin(transaction, {
      ...input,
      creditTransactionId: eligibility.creditTransactionId,
    });
    if (
      !reserved.replayed &&
      eligibility.transactionStatus !== CustomerTransactionStatus.PROCESSING
    ) {
      await this.transitions.transitionWithin(transaction, {
        transactionId: input.transactionId,
        toStatus: CustomerTransactionStatus.PROCESSING,
        source: VerificationTransitionSource.SYSTEM,
        reasonCode:
          input.attemptType === VerificationAttemptType.RECHECK
            ? 'RECHECK_QUEUED'
            : 'VERIFICATION_RESUMED',
        verificationAttemptId: reserved.attempt.id,
      });
    }
    return {
      decision: 'PREPARED',
      attempt: reserved.attempt,
      attemptReplayed: reserved.replayed,
      creditConsumed: eligibility.creditConsumed,
    };
  }
}
