import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { VerificationAttemptEntity } from '../../src/verifications/entities/verification-attempt.entity';
import { CustomerTransactionStatus } from '../../src/verifications/enums/customer-transaction-status.enum';
import { VerificationAttemptResult } from '../../src/verifications/enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';
import { VerificationTransitionSource } from '../../src/verifications/enums/verification-transition-source.enum';
import { PendingRecheckDao } from '../../src/verifications/pending-recheck.dao';
import { VerificationAttemptDao } from '../../src/verifications/verification-attempt.dao';
import { VerificationOutcomeService } from '../../src/verifications/verification-outcome.service';
import { VerificationTransitionDao } from '../../src/verifications/verification-transition.dao';

describe('VerificationOutcomeService', () => {
  const one = jest.fn();
  const databaseTransaction = { one } as unknown as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work(databaseTransaction));
  const finalizeWithin = jest.fn();
  const transitionWithin = jest.fn();
  const scheduleWithin = jest.fn();
  const service = new VerificationOutcomeService(
    { transaction } as unknown as CentralDao,
    { finalizeWithin } as unknown as VerificationAttemptDao,
    { transitionWithin } as unknown as VerificationTransitionDao,
    { scheduleWithin } as unknown as PendingRecheckDao,
  );
  const requestedAt = new Date('2026-08-06T12:00:00.000Z');
  const respondedAt = new Date('2026-08-06T12:00:01.250Z');
  const nextRecheckAt = new Date('2026-08-06T12:05:00.000Z');

  function attempt(
    result: VerificationAttemptResult,
    attemptType = VerificationAttemptType.INITIAL,
  ): VerificationAttemptEntity {
    return new VerificationAttemptEntity({
      id: 'attempt-id',
      transactionId: 'transaction-id',
      businessId: 'business-id',
      branchId: 'branch-id',
      attemptKey: 'verification:initial:transaction-id',
      attemptType,
      attemptNumber: attemptType === VerificationAttemptType.INITIAL ? 1 : 2,
      result,
      creditTransactionId: 'credit-id',
      providerRequestId:
        result === VerificationAttemptResult.QUEUED ? undefined : 'provider-1',
      providerStatus:
        result === VerificationAttemptResult.QUEUED ? undefined : result,
      requestedAt:
        result === VerificationAttemptResult.QUEUED ? undefined : requestedAt,
      respondedAt:
        result === VerificationAttemptResult.QUEUED ? undefined : respondedAt,
      responseTimeMs:
        result === VerificationAttemptResult.QUEUED ? undefined : 1_250,
      createdAt: requestedAt,
    });
  }

  beforeEach(() => jest.clearAllMocks());

  it('finalizes pending and schedules the first recheck in one transaction', async () => {
    const pendingAttempt = attempt(VerificationAttemptResult.PENDING);
    finalizeWithin.mockResolvedValueOnce({
      attempt: pendingAttempt,
      replayed: false,
    });

    await expect(
      service.record({
        attemptKey: pendingAttempt.attemptKey,
        result: VerificationAttemptResult.PENDING,
        providerRequestId: 'provider-1',
        providerStatus: 'PENDING',
        requestedAt,
        respondedAt,
        nextRecheckAt,
      }),
    ).resolves.toMatchObject({
      transactionStatus: CustomerTransactionStatus.PENDING,
      replayed: false,
      nextRecheckNumber: 1,
      recheckLimitReached: false,
    });
    expect(finalizeWithin).toHaveBeenCalledWith(databaseTransaction, {
      attemptKey: pendingAttempt.attemptKey,
      result: VerificationAttemptResult.PENDING,
      providerRequestId: 'provider-1',
      providerStatus: 'PENDING',
      requestedAt,
      respondedAt,
      responseTimeMs: 1_250,
      errorCode: undefined,
    });
    expect(transitionWithin).toHaveBeenCalledWith(databaseTransaction, {
      transactionId: 'transaction-id',
      toStatus: CustomerTransactionStatus.PENDING,
      source: VerificationTransitionSource.VERIFYET,
      reasonCode: 'PROVIDER_PENDING',
      verificationAttemptId: 'attempt-id',
    });
    expect(scheduleWithin).toHaveBeenCalledWith(databaseTransaction, {
      transactionId: 'transaction-id',
      recheckNumber: 1,
      scheduledAt: nextRecheckAt,
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('records a sanitized terminal failure without creating another job', async () => {
    const failed = attempt(VerificationAttemptResult.FAILED);
    finalizeWithin.mockResolvedValueOnce({
      attempt: failed,
      replayed: false,
    });

    await expect(
      service.record({
        attemptKey: failed.attemptKey,
        result: VerificationAttemptResult.FAILED,
        providerRequestId: 'provider-1',
        providerStatus: 'FAILED',
        requestedAt,
        respondedAt,
        errorCode: 'PROVIDER_REJECTED',
      }),
    ).resolves.toMatchObject({
      transactionStatus: CustomerTransactionStatus.FAILED,
      recheckLimitReached: false,
    });
    expect(scheduleWithin).not.toHaveBeenCalled();
  });

  it('replays a persisted outcome without repeating transition or schedule', async () => {
    const pendingAttempt = attempt(VerificationAttemptResult.PENDING);
    finalizeWithin.mockResolvedValueOnce({
      attempt: pendingAttempt,
      replayed: true,
    });

    await expect(
      service.record({
        attemptKey: pendingAttempt.attemptKey,
        result: VerificationAttemptResult.PENDING,
        providerRequestId: 'provider-1',
        providerStatus: 'PENDING',
        requestedAt,
        respondedAt,
      }),
    ).resolves.toMatchObject({ replayed: true, nextRecheckNumber: 1 });
    expect(transitionWithin).not.toHaveBeenCalled();
    expect(scheduleWithin).not.toHaveBeenCalled();
  });

  it('stops scheduling after the third completed recheck without inventing a terminal result', async () => {
    const pendingAttempt = attempt(
      VerificationAttemptResult.PENDING,
      VerificationAttemptType.RECHECK,
    );
    finalizeWithin.mockResolvedValueOnce({
      attempt: pendingAttempt,
      replayed: false,
    });
    one.mockResolvedValueOnce({ recheck_number: 3 });

    await expect(
      service.record({
        attemptKey: pendingAttempt.attemptKey,
        result: VerificationAttemptResult.PENDING,
        providerRequestId: 'provider-1',
        providerStatus: 'PENDING',
        requestedAt,
        respondedAt,
      }),
    ).resolves.toMatchObject({
      transactionStatus: CustomerTransactionStatus.PENDING,
      nextRecheckNumber: undefined,
      recheckLimitReached: true,
    });
    expect(scheduleWithin).not.toHaveBeenCalled();
  });

  it('rejects raw provider values and failed-outcome scheduling before a transaction', () => {
    expect(() =>
      service.record({
        attemptKey: 'verification:initial:transaction-id',
        result: VerificationAttemptResult.FAILED,
        providerRequestId: 'provider-1',
        providerStatus: 'raw failed status',
        requestedAt,
        respondedAt,
      }),
    ).toThrow('provider outcome is invalid');
    expect(() =>
      service.record({
        attemptKey: 'verification:initial:transaction-id',
        result: VerificationAttemptResult.FAILED,
        providerRequestId: 'provider-1',
        providerStatus: 'FAILED',
        requestedAt,
        respondedAt,
        nextRecheckAt,
      }),
    ).toThrow('Only a pending outcome');
    expect(() =>
      service.record({
        attemptKey: 'verification:initial:transaction-id',
        result: VerificationAttemptResult.VERIFIED,
        providerRequestId: 'provider-1',
        providerStatus: 'VERIFIED',
        requestedAt,
        respondedAt,
      }),
    ).toThrow('requires matching and ledger posting');
    expect(transaction).not.toHaveBeenCalled();
  });
});
