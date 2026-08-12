import { ConflictException, NotFoundException } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  CreditGrantReplayConflictError,
  CreditGrantScopeError,
  CreditDeferralBalanceError,
  CreditDeferralReplayConflictError,
  CreditDeferralScopeError,
  CreditLifecycleDao,
} from '../../src/credits/credit-lifecycle.dao';
import { CreditLifecycleService } from '../../src/credits/credit-lifecycle.service';

describe('CreditLifecycleService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const grantWithin = jest.fn();
  const deferSubscriptionWithin = jest.fn();
  const expireDueWithin = jest.fn();
  const service = new CreditLifecycleService(
    { transaction } as unknown as CentralDao,
    {
      grantWithin, deferSubscriptionWithin, expireDueWithin,
    } as unknown as CreditLifecycleDao,
  );
  const grant = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventKey: 'subscription-grant:subscription-id',
    businessId: 'business-id', branchId: 'branch-id',
    subscriptionId: 'subscription-id',
  };
  const deferral = {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    eventKey: 'subscription-deferral:order-id',
    businessId: 'business-id', branchId: 'branch-id',
    subscriptionOrderId: 'order-id',
  };

  beforeEach(() => jest.clearAllMocks());

  it('grants a verified subscription in one central transaction', async () => {
    grantWithin.mockResolvedValue({
      creditLotId: grant.id, creditsGranted: 10_000,
      balanceBefore: 0, balanceAfter: 10_000, replayed: false,
    });
    await expect(service.grantSubscription(grant)).resolves.toMatchObject({
      creditsGranted: 10_000, balanceAfter: 10_000, replayed: false,
    });
    expect(grantWithin).toHaveBeenCalledWith(boundary, grant);
  });

  it('maps missing subscriptions and changed replays safely', async () => {
    grantWithin.mockRejectedValueOnce(new CreditGrantScopeError());
    await expect(service.grantSubscription(grant))
      .rejects.toBeInstanceOf(NotFoundException);
    grantWithin.mockRejectedValueOnce(new CreditGrantReplayConflictError());
    await expect(service.grantSubscription(grant))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('runs bounded exactly-once expiry work through one transaction', async () => {
    const effectiveAt = new Date('2026-09-10T00:00:00Z');
    expireDueWithin.mockResolvedValue([{ creditLotId: grant.id }]);
    await expect(service.expireDue(effectiveAt, 25)).resolves.toHaveLength(1);
    expect(expireDueWithin).toHaveBeenCalledWith(boundary, effectiveAt, 25);
    expect(() => service.expireDue(effectiveAt, 0)).toThrow(RangeError);
    expect(() => service.expireDue(effectiveAt, 501)).toThrow(RangeError);
  });

  it('creates one zero-credit deferred subscription charge', async () => {
    deferSubscriptionWithin.mockResolvedValue({
      deferredDeductionId: deferral.id, balance: 0, replayed: false,
    });
    await expect(service.deferSubscriptionVerification(deferral))
      .resolves.toMatchObject({ balance: 0, replayed: false });
    expect(deferSubscriptionWithin).toHaveBeenCalledWith(boundary, deferral);
  });

  it('maps invalid deferral scope, balance and replay conflicts', async () => {
    for (const [error, type] of [
      [new CreditDeferralScopeError(), NotFoundException],
      [new CreditDeferralBalanceError(), ConflictException],
      [new CreditDeferralReplayConflictError(), ConflictException],
    ] as const) {
      deferSubscriptionWithin.mockRejectedValueOnce(error);
      await expect(service.deferSubscriptionVerification(deferral))
        .rejects.toBeInstanceOf(type);
    }
  });
});
