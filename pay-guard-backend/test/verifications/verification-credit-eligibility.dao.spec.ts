import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { CustomerTransactionStatus } from '../../src/verifications/enums/customer-transaction-status.enum';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';
import {
  VerificationCreditEligibilityDao,
  VerificationCreditPolicyPendingError,
} from '../../src/verifications/verification-credit-eligibility.dao';

describe('VerificationCreditEligibilityDao', () => {
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const execute = jest.fn<Promise<number>, [text: string, values?: readonly unknown[]]>()
    .mockResolvedValue(0);
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work({ one, optional, execute } as unknown as DaoTransaction));
  const dao = new VerificationCreditEligibilityDao({
    transaction,
  } as unknown as CentralDao);
  const input = {
    transactionId: 'transaction-id',
    businessId: 'business-id',
    branchId: 'branch-id',
    attemptType: VerificationAttemptType.INITIAL,
  };
  const activeScope = {
    transaction_status: CustomerTransactionStatus.PROCESSING,
    business_status: 'ACTIVE',
    branch_status: 'ACTIVE',
  };

  beforeEach(() => jest.clearAllMocks());

  it('locks scope and atomically consumes exactly one initial credit', async () => {
    one.mockResolvedValueOnce(activeScope).mockResolvedValueOnce({
      id: 'credit-transaction-id',
      balance_before: '5',
      balance_after: '4',
    });
    optional.mockResolvedValueOnce(undefined).mockResolvedValueOnce({
      balance_before: '5',
      balance_after: '4',
      active_subscription_id: 'subscription-id',
      credit_lot_id: 'credit-lot-id',
    });

    await expect(dao.resolve(input)).resolves.toEqual({
      decision: 'ELIGIBLE',
      transactionStatus: CustomerTransactionStatus.PROCESSING,
      creditConsumed: true,
      replayed: false,
      creditTransactionId: 'credit-transaction-id',
      balanceBefore: 5,
      balanceAfter: 4,
    });
    expect(one.mock.calls[0][0]).toContain(
      'FOR UPDATE OF current_transaction, business, branch',
    );
    expect(optional.mock.calls[1][0]).toContain('available_credits > 0');
    expect(optional.mock.calls[1][0]).toContain("lot.status = 'ACTIVE'");
    expect(one.mock.calls[1][1]).toEqual([
      'business-id',
      'branch-id',
      'subscription-id',
      'credit-lot-id',
      '5',
      '4',
      'transaction-id',
      'verification:initial:transaction-id',
    ]);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining('credit_usage_alerts'),
      ['credit-lot-id', 'credit-transaction-id'],
    );
  });

  it('replays an existing initial debit without touching the wallet', async () => {
    one.mockResolvedValueOnce(activeScope);
    optional.mockResolvedValueOnce({
      id: 'credit-transaction-id',
      balance_before: '5',
      balance_after: '4',
    });

    await expect(dao.resolve(input)).resolves.toMatchObject({
      decision: 'ELIGIBLE',
      creditConsumed: false,
      replayed: true,
      creditTransactionId: 'credit-transaction-id',
    });
    expect(optional).toHaveBeenCalledTimes(1);
  });

  it('returns waiting without creating a negative balance at zero credits', async () => {
    one.mockResolvedValueOnce(activeScope);
    optional.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);

    await expect(dao.resolve(input)).resolves.toEqual({
      decision: 'WAITING_CREDITS',
      transactionStatus: CustomerTransactionStatus.PROCESSING,
      creditConsumed: false,
      replayed: false,
    });
    expect(one).toHaveBeenCalledTimes(1);
  });

  it('pauses before reading or changing credits when business or branch is inactive', async () => {
    one.mockResolvedValueOnce({
      ...activeScope,
      branch_status: 'SUSPENDED',
    });

    await expect(dao.resolve(input)).resolves.toEqual({
      decision: 'PAUSED_BRANCH',
      transactionStatus: CustomerTransactionStatus.PROCESSING,
      creditConsumed: false,
      replayed: false,
    });
    expect(optional).not.toHaveBeenCalled();
  });

  it('allows a pending recheck only when the initial credit event exists', async () => {
    one.mockResolvedValueOnce({
      ...activeScope,
      transaction_status: CustomerTransactionStatus.PENDING,
    });
    optional.mockResolvedValueOnce({
      id: 'initial-credit-id',
      balance_before: '5',
      balance_after: '4',
    });

    await expect(
      dao.resolve({ ...input, attemptType: VerificationAttemptType.RECHECK }),
    ).resolves.toEqual({
      decision: 'ELIGIBLE',
      transactionStatus: CustomerTransactionStatus.PENDING,
      creditConsumed: false,
      replayed: true,
      creditTransactionId: 'initial-credit-id',
      balanceBefore: 5,
      balanceAfter: 4,
    });
    expect(optional).toHaveBeenCalledTimes(1);
  });

  it('rejects a free recheck without a prior initial debit', async () => {
    one.mockResolvedValueOnce({
      ...activeScope,
      transaction_status: CustomerTransactionStatus.PENDING,
    });
    optional.mockResolvedValueOnce(undefined);

    await expect(
      dao.resolve({ ...input, attemptType: VerificationAttemptType.RECHECK }),
    ).rejects.toThrow('requires an initial credit event');
  });

  it('keeps unapproved repeat and subscription charging disabled', () => {
    for (const attemptType of [
      VerificationAttemptType.REPEAT,
      VerificationAttemptType.SUBSCRIPTION,
    ]) {
      expect(() => dao.resolve({ ...input, attemptType })).toThrow(
        VerificationCreditPolicyPendingError,
      );
    }
    expect(transaction).not.toHaveBeenCalled();
  });
});
