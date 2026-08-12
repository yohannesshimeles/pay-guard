import { PendingRecheckEntity } from '../../src/verifications/entities/pending-recheck.entity';
import { PendingRecheckStatus } from '../../src/verifications/enums/pending-recheck-status.enum';
import { PendingRecheckDao } from '../../src/verifications/pending-recheck.dao';
import { PendingRecheckCoordinatorService } from '../../src/verifications/pending-recheck-coordinator.service';
import { VerificationOutcomeService } from '../../src/verifications/verification-outcome.service';
import { VerifiedPaymentPostingService } from '../../src/verifications/verified-payment-posting.service';
import { UnconfiguredVerifyEtProviderAdapter } from '../../src/verify-et/verify-et-provider.adapter';
import { VerifyEtOperationalAlertDao } from '../../src/verify-et/verify-et-operational-alert.dao';
import { VerifyEtPollingPolicyService } from '../../src/verify-et/verify-et-polling-policy.service';
import { VerifyEtProviderError } from '../../src/verify-et/verify-et-provider.error';
import { VerifyEtRequestHistoryDao } from '../../src/verify-et/verify-et-request-history.dao';
import { VerifyEtWorkItemDao } from '../../src/verify-et/verify-et-work-item.dao';
import { VerifyEtWorkerService } from '../../src/verify-et/verify-et-worker.service';

describe('VerifyEtWorkerService', () => {
  const claimNext = jest.fn();
  const completeClaim = jest.fn();
  const deferClaim = jest.fn();
  const pauseClaim = jest.fn();
  const prepareActiveClaim = jest.fn();
  const requireByAttemptId = jest.fn();
  const reserve = jest.fn();
  const markSent = jest.fn();
  const complete = jest.fn();
  const planRetry = jest.fn();
  const createAlert = jest.fn();
  const record = jest.fn();
  const post = jest.fn();
  const verify = jest.fn();
  const worker = new VerifyEtWorkerService(
    {
      claimNext,
      completeClaim,
      deferClaim,
      pauseClaim,
    } as unknown as PendingRecheckDao,
    { prepareActiveClaim } as unknown as PendingRecheckCoordinatorService,
    { requireByAttemptId } as unknown as VerifyEtWorkItemDao,
    { reserve, markSent, complete } as unknown as VerifyEtRequestHistoryDao,
    { planRetry } as unknown as VerifyEtPollingPolicyService,
    { create: createAlert } as unknown as VerifyEtOperationalAlertDao,
    { record } as unknown as VerificationOutcomeService,
    { post } as unknown as VerifiedPaymentPostingService,
    { verify },
  );
  const claim = new PendingRecheckEntity({
    id: 'recheck-id',
    transactionId: 'transaction-id',
    businessId: 'business-id',
    branchId: 'branch-id',
    recheckNumber: 1,
    scheduledAt: new Date('2026-08-06T12:00:00.000Z'),
    status: PendingRecheckStatus.CLAIMED,
    claimToken: 'claim-token',
    claimedBy: 'worker-01',
    claimedAt: new Date('2026-08-06T12:00:01.000Z'),
    claimExpiresAt: new Date('2026-08-06T12:01:01.000Z'),
    createdAt: new Date('2026-08-06T11:59:00.000Z'),
  });
  const attempt = { id: '11111111-1111-4111-8111-111111111111' };
  const workItem = {
    verificationAttemptId: attempt.id,
    attemptKey: 'verification:recheck:transaction-id:1',
    bankId: '22222222-2222-4222-8222-222222222222',
    bankCode: 'CBE',
    transactionReference: 'REFERENCE-001',
    amount: '125.50',
    receiverAccountSuffix: '1234',
  };
  const requestedAt = new Date('2026-08-06T12:00:02.000Z');
  const respondedAt = new Date('2026-08-06T12:00:03.000Z');

  beforeEach(() => {
    jest.clearAllMocks();
    claimNext.mockResolvedValue(claim);
    prepareActiveClaim.mockResolvedValue({
      decision: 'PREPARED',
      recheck: claim,
      attempt,
    });
    requireByAttemptId.mockResolvedValue(workItem);
    reserve.mockResolvedValue({
      replayed: false,
      record: { id: 'request-record-id', status: 'RESERVED', attemptCount: 0 },
    });
    markSent.mockResolvedValue({
      id: 'request-record-id',
      status: 'SENT',
      attemptCount: 1,
    });
    complete.mockResolvedValue({});
    completeClaim.mockResolvedValue({});
  });

  it('returns idle without preparing or dispatching work', async () => {
    claimNext.mockResolvedValueOnce(undefined);
    await expect(worker.processNext('worker-01')).resolves.toEqual({
      status: 'IDLE',
    });
    expect(prepareActiveClaim).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps the default external provider transport fail-closed', () => {
    const adapter = new UnconfiguredVerifyEtProviderAdapter();
    expect(() => adapter.verify()).toThrow('transport is not configured');
  });

  it('persists a normalized pending result before completing the claim', async () => {
    const order: string[] = [];
    const nextRecheckAt = new Date('2026-08-06T12:05:00.000Z');
    verify.mockResolvedValueOnce({
      result: 'PENDING',
      httpStatus: 202,
      providerRequestId: 'provider-request-1',
      providerStatus: 'PENDING',
      requestedAt,
      respondedAt,
      nextRecheckAt,
    });
    record.mockImplementationOnce(() => {
      order.push('outcome');
      return Promise.resolve({ replayed: false });
    });
    completeClaim.mockImplementationOnce(() => {
      order.push('claim');
      return Promise.resolve({});
    });

    await expect(worker.processNext('worker-01')).resolves.toMatchObject({
      status: 'PROCESSED',
      decision: 'PENDING',
      replayed: false,
    });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptKey: workItem.attemptKey,
        providerRequestId: 'provider-request-1',
        nextRecheckAt,
      }),
    );
    expect(order).toEqual(['outcome', 'claim']);
  });

  it('routes a verified result through matching and financial posting', async () => {
    verify.mockResolvedValueOnce({
      result: 'VERIFIED',
      httpStatus: 200,
      providerRequestId: 'provider-request-2',
      providerStatus: 'VERIFIED',
      requestedAt,
      respondedAt,
      providerBankId: workItem.bankId,
      transactionReference: workItem.transactionReference,
      amount: workItem.amount,
      receiverAccountSuffix: workItem.receiverAccountSuffix,
      providerTransactionAt: requestedAt,
    });
    post.mockResolvedValueOnce({ decision: 'DUPLICATE', replayed: false });

    await expect(worker.processNext('worker-01')).resolves.toMatchObject({
      status: 'PROCESSED',
      decision: 'DUPLICATE',
    });
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        attemptKey: workItem.attemptKey,
        providerBankId: workItem.bankId,
      }),
    );
    expect(record).not.toHaveBeenCalled();
  });

  it('defers retryable provider failures using the bounded polling decision', async () => {
    const scheduledAt = new Date('2026-08-06T12:01:00.000Z');
    const error = new VerifyEtProviderError('RATE_LIMITED', true, 429, 10);
    verify.mockRejectedValueOnce(error);
    planRetry.mockReturnValueOnce({
      action: 'SCHEDULE',
      nextAttempt: 2,
      delayMs: 10_000,
      scheduledAt,
    });
    deferClaim.mockResolvedValueOnce({});

    await expect(worker.processNext('worker-01')).resolves.toEqual({
      status: 'DEFERRED',
      transactionId: 'transaction-id',
      errorCode: 'RATE_LIMITED',
      scheduledAt,
    });
    expect(planRetry).toHaveBeenCalledWith({
      requestKey: `verifyet:status:${attempt.id}`,
      attemptsCompleted: 1,
      error,
    });
    expect(deferClaim).toHaveBeenCalledWith(
      'recheck-id',
      'claim-token',
      scheduledAt,
      'RATE_LIMITED',
    );
    expect(createAlert).not.toHaveBeenCalled();
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('pauses and alerts on a non-retryable provider authentication failure', async () => {
    const error = new VerifyEtProviderError(
      'AUTHENTICATION_FAILED',
      false,
      401,
    );
    verify.mockRejectedValueOnce(error);
    planRetry.mockReturnValueOnce({ action: 'STOP', reason: 'NON_RETRYABLE' });
    createAlert.mockResolvedValueOnce({});
    pauseClaim.mockResolvedValueOnce({});

    await expect(worker.processNext('worker-01')).resolves.toEqual({
      status: 'PAUSED_PROVIDER',
      transactionId: 'transaction-id',
      errorCode: 'AUTHENTICATION_FAILED',
    });
    expect(createAlert).toHaveBeenCalledWith({
      requestRecordId: 'request-record-id',
      transactionId: 'transaction-id',
      errorCode: 'AUTHENTICATION_FAILED',
    });
    expect(pauseClaim).toHaveBeenCalledWith(
      'recheck-id',
      'claim-token',
      PendingRecheckStatus.PAUSED_PROVIDER,
      'AUTHENTICATION_FAILED',
    );
    expect(deferClaim).not.toHaveBeenCalled();
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('leaves the claim incomplete when provider dispatch fails', async () => {
    verify.mockRejectedValueOnce(new Error('provider unavailable'));
    await expect(worker.processNext('worker-01')).rejects.toThrow(
      'provider unavailable',
    );
    expect(complete).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
    expect(post).not.toHaveBeenCalled();
    expect(completeClaim).not.toHaveBeenCalled();
  });
});
