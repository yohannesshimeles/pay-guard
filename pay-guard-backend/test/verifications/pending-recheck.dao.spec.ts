import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { PendingRecheckStatus } from '../../src/verifications/enums/pending-recheck-status.enum';
import {
  PendingRecheckClaimLostError,
  PendingRecheckDao,
  PendingRecheckScheduleConflictError,
} from '../../src/verifications/pending-recheck.dao';

describe('PendingRecheckDao', () => {
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work({ one, optional } as unknown as DaoTransaction));
  const dao = new PendingRecheckDao({
    transaction,
    optional,
  } as unknown as CentralDao);
  const scheduledAt = new Date('2026-08-06T12:05:00.000Z');
  const createdAt = new Date('2026-08-06T12:00:00.000Z');
  const scheduledRow = {
    id: 'recheck-id',
    transaction_id: 'transaction-id',
    business_id: 'business-id',
    branch_id: 'branch-id',
    recheck_number: 1,
    scheduled_at: scheduledAt,
    status: PendingRecheckStatus.SCHEDULED,
    claim_token: null,
    claimed_by: null,
    claimed_at: null,
    claim_expires_at: null,
    verification_attempt_id: null,
    pause_reason: null,
    paused_at: null,
    resumed_at: null,
    completed_at: null,
    last_error_code: null,
    created_at: createdAt,
  };

  beforeEach(() => jest.clearAllMocks());

  it('schedules exactly one numbered job for a locked pending transaction', async () => {
    one.mockResolvedValueOnce({ current_status: 'PENDING' });
    optional.mockResolvedValueOnce(scheduledRow);

    await expect(
      dao.schedule({
        transactionId: 'transaction-id',
        recheckNumber: 1,
        scheduledAt,
      }),
    ).resolves.toMatchObject({
      id: 'recheck-id',
      status: PendingRecheckStatus.SCHEDULED,
    });
    expect(one.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(optional.mock.calls[0][0]).toContain(
      'ON CONFLICT (transaction_id, recheck_number) DO NOTHING',
    );
  });

  it('rejects reuse of a number with a different schedule', async () => {
    one
      .mockResolvedValueOnce({ current_status: 'PENDING' })
      .mockResolvedValueOnce({
        ...scheduledRow,
        scheduled_at: new Date(scheduledAt.getTime() + 60_000),
      });
    optional.mockResolvedValueOnce(undefined);

    await expect(
      dao.schedule({
        transactionId: 'transaction-id',
        recheckNumber: 1,
        scheduledAt,
      }),
    ).rejects.toThrow(PendingRecheckScheduleConflictError);
  });

  it('claims due or expired work with skip-locked and a bounded lease', async () => {
    optional.mockResolvedValueOnce({
      ...scheduledRow,
      status: PendingRecheckStatus.CLAIMED,
      claim_token: 'claim-token',
      claimed_by: 'worker-01',
      claimed_at: new Date('2026-08-06T12:05:01.000Z'),
      claim_expires_at: new Date('2026-08-06T12:06:01.000Z'),
    });

    await expect(dao.claimNext('worker-01', 60)).resolves.toMatchObject({
      claimToken: 'claim-token',
      claimedBy: 'worker-01',
    });
    expect(optional.mock.calls[0][0]).toContain('FOR UPDATE SKIP LOCKED');
    expect(optional.mock.calls[0][0]).toContain(
      "status = 'CLAIMED' AND claim_expires_at <= now()",
    );
  });

  it('completes only a live claim owned by the matching token', async () => {
    optional.mockResolvedValueOnce({
      ...scheduledRow,
      status: PendingRecheckStatus.COMPLETED,
      verification_attempt_id: 'attempt-id',
      completed_at: new Date('2026-08-06T12:05:10.000Z'),
    });

    await expect(
      dao.completeClaim('recheck-id', 'claim-token', 'attempt-id'),
    ).resolves.toMatchObject({
      status: PendingRecheckStatus.COMPLETED,
      verificationAttemptId: 'attempt-id',
    });
    expect(optional.mock.calls[0][0]).toContain('claim_expires_at > now()');
    expect(optional.mock.calls[0][1]).toEqual([
      'recheck-id',
      'claim-token',
      'attempt-id',
    ]);
  });

  it('binds an attempt without releasing the active worker claim', async () => {
    optional.mockResolvedValueOnce({
      ...scheduledRow,
      status: PendingRecheckStatus.CLAIMED,
      claim_token: 'claim-token',
      claimed_by: 'worker-01',
      claimed_at: new Date('2026-08-06T12:05:01.000Z'),
      claim_expires_at: new Date('2026-08-06T12:06:01.000Z'),
      verification_attempt_id: 'attempt-id',
    });

    await expect(
      dao.bindAttemptToClaim('recheck-id', 'claim-token', 'attempt-id'),
    ).resolves.toMatchObject({
      status: PendingRecheckStatus.CLAIMED,
      verificationAttemptId: 'attempt-id',
    });
    expect(optional.mock.calls[0][0]).toContain(
      'verification_attempt_id IS NULL OR verification_attempt_id = $3',
    );
  });

  it('renews only a currently live claim with a bounded lease', async () => {
    optional.mockResolvedValueOnce({
      ...scheduledRow,
      status: PendingRecheckStatus.CLAIMED,
      claim_token: 'claim-token',
      claimed_by: 'worker-01',
      claimed_at: new Date('2026-08-06T12:05:01.000Z'),
      claim_expires_at: new Date('2026-08-06T12:07:01.000Z'),
    });

    await expect(
      dao.renewClaim('recheck-id', 'claim-token', 120),
    ).resolves.toMatchObject({ claimToken: 'claim-token' });
    expect(optional.mock.calls[0][1]).toEqual([
      'recheck-id',
      'claim-token',
      120,
    ]);
  });

  it('fails closed when another worker owns or has reclaimed the lease', async () => {
    optional.mockResolvedValueOnce(undefined);
    await expect(
      dao.completeClaim('recheck-id', 'stale-token', 'attempt-id'),
    ).rejects.toThrow(PendingRecheckClaimLostError);
  });
});
