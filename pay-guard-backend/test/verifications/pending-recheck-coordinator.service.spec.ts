import { PendingRecheckEntity } from '../../src/verifications/entities/pending-recheck.entity';
import { PendingRecheckStatus } from '../../src/verifications/enums/pending-recheck-status.enum';
import { PendingRecheckCoordinatorService } from '../../src/verifications/pending-recheck-coordinator.service';
import { PendingRecheckDao } from '../../src/verifications/pending-recheck.dao';
import { VerificationPreparationService } from '../../src/verifications/verification-preparation.service';

describe('PendingRecheckCoordinatorService', () => {
  const prepare = jest.fn();
  const bindAttemptToClaim = jest.fn();
  const completeClaim = jest.fn();
  const pauseClaim = jest.fn();
  const coordinator = new PendingRecheckCoordinatorService(
    {
      bindAttemptToClaim,
      completeClaim,
      pauseClaim,
    } as unknown as PendingRecheckDao,
    { prepare } as unknown as VerificationPreparationService,
  );
  const claim = new PendingRecheckEntity({
    id: 'recheck-id',
    transactionId: 'transaction-id',
    businessId: 'business-id',
    branchId: 'branch-id',
    recheckNumber: 2,
    scheduledAt: new Date('2026-08-06T12:05:00.000Z'),
    status: PendingRecheckStatus.CLAIMED,
    claimToken: 'claim-token',
    claimedBy: 'worker-01',
    claimedAt: new Date('2026-08-06T12:05:01.000Z'),
    claimExpiresAt: new Date('2026-08-06T12:06:01.000Z'),
    createdAt: new Date('2026-08-06T12:00:00.000Z'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('uses a deterministic key and completes the claimed job after preparation', async () => {
    prepare.mockResolvedValueOnce({
      decision: 'PREPARED',
      attempt: { id: 'attempt-id' },
    });
    bindAttemptToClaim.mockResolvedValueOnce(claim);
    completeClaim.mockResolvedValueOnce({
      ...claim,
      status: PendingRecheckStatus.COMPLETED,
    });

    await expect(coordinator.prepareClaim(claim)).resolves.toMatchObject({
      decision: 'PREPARED',
      recheck: { status: PendingRecheckStatus.COMPLETED },
    });
    expect(prepare).toHaveBeenCalledWith({
      transactionId: 'transaction-id',
      businessId: 'business-id',
      branchId: 'branch-id',
      attemptType: 'RECHECK',
      attemptKey: 'verification:recheck:transaction-id:2',
    });
    expect(completeClaim).toHaveBeenCalledWith(
      'recheck-id',
      'claim-token',
      'attempt-id',
    );
    expect(bindAttemptToClaim).toHaveBeenCalledWith(
      'recheck-id',
      'claim-token',
      'attempt-id',
    );
  });

  it('binds an attempt while retaining the active claim for worker dispatch', async () => {
    prepare.mockResolvedValueOnce({
      decision: 'PREPARED',
      attempt: { id: 'attempt-id' },
    });
    bindAttemptToClaim.mockResolvedValueOnce(claim);

    await expect(coordinator.prepareActiveClaim(claim)).resolves.toMatchObject({
      decision: 'PREPARED',
      recheck: { status: PendingRecheckStatus.CLAIMED },
      attempt: { id: 'attempt-id' },
    });
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('durably pauses a blocked branch and creates no completion', async () => {
    prepare.mockResolvedValueOnce({ decision: 'PAUSED_BRANCH' });
    pauseClaim.mockResolvedValueOnce({
      ...claim,
      status: PendingRecheckStatus.PAUSED_BRANCH,
    });

    await expect(coordinator.prepareClaim(claim)).resolves.toMatchObject({
      decision: 'PAUSED_BRANCH',
    });
    expect(pauseClaim).toHaveBeenCalledWith(
      'recheck-id',
      'claim-token',
      PendingRecheckStatus.PAUSED_BRANCH,
      'BRANCH_NOT_ACTIVE',
    );
    expect(completeClaim).not.toHaveBeenCalled();
  });

  it('rejects unclaimed input before invoking preparation', async () => {
    const unclaimed = new PendingRecheckEntity({
      id: 'recheck-id',
      transactionId: 'transaction-id',
      businessId: 'business-id',
      branchId: 'branch-id',
      recheckNumber: 1,
      scheduledAt: claim.scheduledAt,
      status: PendingRecheckStatus.SCHEDULED,
      createdAt: claim.createdAt,
    });
    await expect(coordinator.prepareClaim(unclaimed)).rejects.toThrow(
      'must have an active worker claim',
    );
    expect(prepare).not.toHaveBeenCalled();
  });
});
