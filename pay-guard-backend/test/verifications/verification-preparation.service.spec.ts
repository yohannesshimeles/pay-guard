import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { VerificationAttemptEntity } from '../../src/verifications/entities/verification-attempt.entity';
import { CustomerTransactionStatus } from '../../src/verifications/enums/customer-transaction-status.enum';
import { VerificationAttemptResult } from '../../src/verifications/enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';
import { VerificationTransitionSource } from '../../src/verifications/enums/verification-transition-source.enum';
import { VerificationAttemptDao } from '../../src/verifications/verification-attempt.dao';
import { VerificationCreditEligibilityDao } from '../../src/verifications/verification-credit-eligibility.dao';
import { VerificationPreparationService } from '../../src/verifications/verification-preparation.service';
import { VerificationTransitionDao } from '../../src/verifications/verification-transition.dao';

describe('VerificationPreparationService', () => {
  const databaseTransaction = {} as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work(databaseTransaction));
  const findByKeyWithin = jest.fn();
  const assertBinding = jest.fn();
  const reserveWithin = jest.fn();
  const resolveWithin = jest.fn();
  const transitionWithin = jest.fn();
  const service = new VerificationPreparationService(
    { transaction } as unknown as CentralDao,
    { resolveWithin } as unknown as VerificationCreditEligibilityDao,
    {
      findByKeyWithin,
      assertBinding,
      reserveWithin,
    } as unknown as VerificationAttemptDao,
    { transitionWithin } as unknown as VerificationTransitionDao,
  );
  const input = {
    transactionId: 'transaction-id',
    businessId: 'business-id',
    branchId: 'branch-id',
    attemptKey: 'verification:recheck:transaction-id:1',
    attemptType: VerificationAttemptType.RECHECK,
  };
  const attempt = new VerificationAttemptEntity({
    id: 'attempt-id',
    ...input,
    attemptNumber: 2,
    result: VerificationAttemptResult.QUEUED,
    creditTransactionId: 'credit-id',
    createdAt: new Date('2026-08-06T12:00:00.000Z'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns an exact attempt-key replay without repeating credit resolution', async () => {
    findByKeyWithin.mockResolvedValueOnce(attempt);

    await expect(service.prepare(input)).resolves.toEqual({
      decision: 'PREPARED',
      attempt,
      attemptReplayed: true,
      creditConsumed: false,
    });
    expect(assertBinding).toHaveBeenCalledWith(attempt, {
      ...input,
      creditTransactionId: 'credit-id',
    });
    expect(resolveWithin).not.toHaveBeenCalled();
  });

  it('reserves an eligible recheck and resumes pending processing atomically', async () => {
    findByKeyWithin.mockResolvedValueOnce(undefined);
    resolveWithin.mockResolvedValueOnce({
      decision: 'ELIGIBLE',
      transactionStatus: CustomerTransactionStatus.PENDING,
      creditConsumed: false,
      replayed: true,
      creditTransactionId: 'credit-id',
    });
    reserveWithin.mockResolvedValueOnce({ attempt, replayed: false });

    await expect(service.prepare(input)).resolves.toEqual({
      decision: 'PREPARED',
      attempt,
      attemptReplayed: false,
      creditConsumed: false,
    });
    expect(transitionWithin).toHaveBeenCalledWith(databaseTransaction, {
      transactionId: 'transaction-id',
      toStatus: CustomerTransactionStatus.PROCESSING,
      source: VerificationTransitionSource.SYSTEM,
      reasonCode: 'RECHECK_QUEUED',
      verificationAttemptId: 'attempt-id',
    });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('moves a zero-credit request to its durable waiting state', async () => {
    findByKeyWithin.mockResolvedValueOnce(undefined);
    resolveWithin.mockResolvedValueOnce({
      decision: 'WAITING_CREDITS',
      transactionStatus: CustomerTransactionStatus.PROCESSING,
      creditConsumed: false,
      replayed: false,
    });

    await expect(service.prepare(input)).resolves.toEqual({
      decision: 'WAITING_CREDITS',
      statusChanged: true,
    });
    expect(transitionWithin).toHaveBeenCalledWith(databaseTransaction, {
      transactionId: 'transaction-id',
      toStatus: CustomerTransactionStatus.WAITING_CREDITS,
      source: VerificationTransitionSource.CREDIT_POLICY,
      reasonCode: 'CREDITS_EXHAUSTED',
    });
    expect(reserveWithin).not.toHaveBeenCalled();
  });

  it('does not duplicate an already-persisted blocked transition', async () => {
    findByKeyWithin.mockResolvedValueOnce(undefined);
    resolveWithin.mockResolvedValueOnce({
      decision: 'PAUSED_BRANCH',
      transactionStatus: CustomerTransactionStatus.PAUSED_BRANCH,
      creditConsumed: false,
      replayed: false,
    });

    await expect(service.prepare(input)).resolves.toEqual({
      decision: 'PAUSED_BRANCH',
      statusChanged: false,
    });
    expect(transitionWithin).not.toHaveBeenCalled();
  });
});
