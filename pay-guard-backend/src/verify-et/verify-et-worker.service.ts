import { Inject, Injectable } from '@nestjs/common';
import { PendingRecheckStatus } from '../verifications/enums/pending-recheck-status.enum';
import { VerificationAttemptResult } from '../verifications/enums/verification-attempt-result.enum';
import { PendingRecheckDao } from '../verifications/pending-recheck.dao';
import { PendingRecheckCoordinatorService } from '../verifications/pending-recheck-coordinator.service';
import { VerificationOutcomeService } from '../verifications/verification-outcome.service';
import { VerifiedPaymentPostingService } from '../verifications/verified-payment-posting.service';
import {
  VERIFYET_PROVIDER_ADAPTER,
  VerifyEtProviderAdapter,
  VerifyEtProviderResult,
} from './verify-et-provider.adapter';
import { VerifyEtOperationalAlertDao } from './verify-et-operational-alert.dao';
import { VerifyEtPollingPolicyService } from './verify-et-polling-policy.service';
import { VerifyEtProviderError } from './verify-et-provider.error';
import { VerifyEtRequestHistoryDao } from './verify-et-request-history.dao';
import { VerifyEtWorkItemDao } from './verify-et-work-item.dao';

export type VerifyEtWorkerResult = Readonly<{
  status: 'IDLE' | 'BLOCKED' | 'PROCESSED' | 'DEFERRED' | 'PAUSED_PROVIDER';
  transactionId?: string;
  decision?: 'PENDING' | 'FAILED' | 'VERIFIED' | 'DUPLICATE';
  replayed?: boolean;
  errorCode?: string;
  scheduledAt?: Date;
}>;

@Injectable()
export class VerifyEtWorkerService {
  constructor(
    private readonly rechecks: PendingRecheckDao,
    private readonly coordinator: PendingRecheckCoordinatorService,
    private readonly workItems: VerifyEtWorkItemDao,
    private readonly history: VerifyEtRequestHistoryDao,
    private readonly polling: VerifyEtPollingPolicyService,
    private readonly alerts: VerifyEtOperationalAlertDao,
    private readonly outcomes: VerificationOutcomeService,
    private readonly postings: VerifiedPaymentPostingService,
    @Inject(VERIFYET_PROVIDER_ADAPTER)
    private readonly provider: VerifyEtProviderAdapter,
  ) {}

  async processNext(
    workerId: string,
    leaseSeconds = 60,
  ): Promise<VerifyEtWorkerResult> {
    const claim = await this.rechecks.claimNext(workerId, leaseSeconds);
    if (!claim) return { status: 'IDLE' };
    const preparation = await this.coordinator.prepareActiveClaim(claim);
    if (preparation.decision !== 'PREPARED') {
      return { status: 'BLOCKED', transactionId: claim.transactionId };
    }

    const workItem = await this.workItems.requireByAttemptId(
      preparation.attempt.id,
    );
    const idempotencyKey = `verifyet:status:${preparation.attempt.id}`;
    const request = {
      idempotencyKey,
      verificationAttemptId: preparation.attempt.id,
      bankCode: workItem.bankCode,
      transactionReference: workItem.transactionReference,
      amount: workItem.amount,
      receiverAccountSuffix: workItem.receiverAccountSuffix,
    };
    const reserved = await this.history.reserve({
      verificationAttemptId: request.verificationAttemptId,
      operation: 'STATUS',
      idempotencyKey,
      payload: request,
      bankCode: request.bankCode,
      amountEtb: request.amount,
    });
    let sent = reserved.record;
    if (
      reserved.record.status === 'RESERVED' ||
      reserved.record.status === 'SENT' ||
      reserved.record.status === 'FAILED'
    ) {
      sent = await this.history.markSent(reserved.record.id);
    }
    let providerResult: VerifyEtProviderResult;
    try {
      providerResult = await this.provider.verify(request);
    } catch (error) {
      if (!(error instanceof VerifyEtProviderError)) throw error;
      await this.history.complete({
        requestRecordId: reserved.record.id,
        httpStatus: error.providerStatus ?? 599,
        responsePayload: { errorCode: error.code, retryable: error.retryable },
        providerStatus: 'ERROR',
        errorCode: error.code,
        succeeded: false,
      });
      const retry = this.polling.planRetry({
        requestKey: idempotencyKey,
        attemptsCompleted: sent.attemptCount,
        error,
      });
      if (retry.action === 'SCHEDULE') {
        await this.rechecks.deferClaim(
          claim.id,
          claim.claimToken!,
          retry.scheduledAt,
          error.code,
        );
        return {
          status: 'DEFERRED',
          transactionId: claim.transactionId,
          errorCode: error.code,
          scheduledAt: retry.scheduledAt,
        };
      }
      await this.alerts.create({
        requestRecordId: reserved.record.id,
        transactionId: claim.transactionId,
        errorCode: error.code,
      });
      await this.rechecks.pauseClaim(
        claim.id,
        claim.claimToken!,
        PendingRecheckStatus.PAUSED_PROVIDER,
        error.code,
      );
      return {
        status: 'PAUSED_PROVIDER',
        transactionId: claim.transactionId,
        errorCode: error.code,
      };
    }
    await this.history.complete({
      requestRecordId: reserved.record.id,
      httpStatus: providerResult.httpStatus,
      responsePayload: providerResult,
      providerStatus: providerResult.providerStatus,
      providerRequestId: providerResult.providerRequestId,
      errorCode:
        providerResult.result === 'FAILED'
          ? providerResult.errorCode
          : undefined,
      succeeded:
        providerResult.httpStatus >= 200 && providerResult.httpStatus < 300,
    });

    const result = await this.persistOutcome(workItem, providerResult);
    await this.rechecks.completeClaim(
      claim.id,
      claim.claimToken!,
      preparation.attempt.id,
    );
    return {
      status: 'PROCESSED',
      transactionId: claim.transactionId,
      decision: result.decision,
      replayed: result.replayed,
    };
  }

  private async persistOutcome(
    workItem: Awaited<ReturnType<VerifyEtWorkItemDao['requireByAttemptId']>>,
    providerResult: VerifyEtProviderResult,
  ): Promise<{
    decision: VerifyEtWorkerResult['decision'];
    replayed: boolean;
  }> {
    if (providerResult.result === 'VERIFIED') {
      const posted = await this.postings.post({
        attemptKey: workItem.attemptKey,
        providerRequestId: providerResult.providerRequestId,
        providerStatus: 'VERIFIED',
        requestedAt: providerResult.requestedAt,
        respondedAt: providerResult.respondedAt,
        providerBankId: providerResult.providerBankId,
        transactionReference: providerResult.transactionReference,
        amount: providerResult.amount,
        receiverAccountSuffix: providerResult.receiverAccountSuffix,
        providerTransactionAt: providerResult.providerTransactionAt,
      });
      return { decision: posted.decision, replayed: posted.replayed };
    }
    const outcome = await this.outcomes.record({
      attemptKey: workItem.attemptKey,
      result:
        providerResult.result === 'PENDING'
          ? VerificationAttemptResult.PENDING
          : VerificationAttemptResult.FAILED,
      providerRequestId: providerResult.providerRequestId,
      providerStatus: providerResult.providerStatus,
      requestedAt: providerResult.requestedAt,
      respondedAt: providerResult.respondedAt,
      errorCode:
        providerResult.result === 'FAILED'
          ? providerResult.errorCode
          : undefined,
      nextRecheckAt:
        providerResult.result === 'PENDING'
          ? providerResult.nextRecheckAt
          : undefined,
    });
    return { decision: providerResult.result, replayed: outcome.replayed };
  }
}
