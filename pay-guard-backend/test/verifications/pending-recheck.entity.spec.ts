import { PendingRecheckEntity } from '../../src/verifications/entities/pending-recheck.entity';
import { PendingRecheckStatus } from '../../src/verifications/enums/pending-recheck-status.enum';

const scheduledAt = new Date('2026-08-06T12:05:00.000Z');
const claimedAt = new Date('2026-08-06T12:05:01.000Z');
const claimExpiresAt = new Date('2026-08-06T12:06:01.000Z');
const base = {
  id: 'recheck-id',
  transactionId: 'transaction-id',
  businessId: 'business-id',
  branchId: 'branch-id',
  recheckNumber: 1,
  scheduledAt,
  status: PendingRecheckStatus.SCHEDULED,
  createdAt: scheduledAt,
};

describe('PendingRecheckEntity', () => {
  it('models a complete bounded worker lease', () => {
    const recheck = new PendingRecheckEntity({
      ...base,
      status: PendingRecheckStatus.CLAIMED,
      claimToken: 'claim-token',
      claimedBy: 'worker-01',
      claimedAt,
      claimExpiresAt,
    });
    expect(recheck).toMatchObject({
      recheckNumber: 1,
      status: PendingRecheckStatus.CLAIMED,
      claimedBy: 'worker-01',
    });
  });

  it('rejects out-of-range numbers and incomplete claims', () => {
    expect(
      () => new PendingRecheckEntity({ ...base, recheckNumber: 4 }),
    ).toThrow('between one and three');
    expect(
      () =>
        new PendingRecheckEntity({
          ...base,
          status: PendingRecheckStatus.CLAIMED,
          claimToken: 'claim-token',
        }),
    ).toThrow('claim lease is inconsistent');
    expect(
      () =>
        new PendingRecheckEntity({
          ...base,
          claimedBy: 'orphan-worker',
        }),
    ).toThrow('claim lease is inconsistent');
  });

  it('requires completion time only for completed jobs', () => {
    expect(
      () =>
        new PendingRecheckEntity({
          ...base,
          status: PendingRecheckStatus.COMPLETED,
        }),
    ).toThrow('completion timestamp is inconsistent');
    expect(
      () => new PendingRecheckEntity({ ...base, completedAt: scheduledAt }),
    ).toThrow('completion timestamp is inconsistent');
  });
});
