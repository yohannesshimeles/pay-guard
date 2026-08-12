import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CreditEventEntity } from '../../src/credits/credit-event.entity';
import { CreditEventType } from '../../src/credits/credit-event-type.enum';
import { CreditLotEntity } from '../../src/credits/credit-lot.entity';
import { CreditQueryDao } from '../../src/credits/credit-query.dao';
import { CreditQueryService } from '../../src/credits/credit-query.service';
import { CreditWalletEntity } from '../../src/credits/credit-wallet.entity';

describe('CreditQueryService', () => {
  const findWallet = jest.fn();
  const listLots = jest.fn();
  const listHistory = jest.fn();
  const listAlerts = jest.fn();
  const service = new CreditQueryService({
    findWallet, listLots, listHistory, listAlerts,
  } as unknown as CreditQueryDao);
  const actor: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: 'session-id', role: 'MANAGER',
    identityType: 'BUSINESS_USER', businessIds: ['business-id'],
    branchId: 'branch-id', membershipId: 'membership-id',
    membershipRoleId: 'role-id', workAssignmentId: 'work-id',
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns exact-branch wallet balances and expiring lots', async () => {
    findWallet.mockResolvedValue(new CreditWalletEntity({
      businessId: 'business-id', branchId: 'branch-id',
      purchasedCredits: 10_000, usedCredits: 1, expiredCredits: 0,
      availableCredits: 9_999, updatedAt: new Date('2026-08-09T00:00:00Z'),
    }));
    listLots.mockResolvedValue([new CreditLotEntity({
      id: 'lot-id', allocatedCredits: 10_000, usedCredits: 1,
      expiredCredits: 0, remainingCredits: 9_999,
      startsAt: new Date('2026-08-09T00:00:00Z'),
      expiresAt: new Date('2026-09-09T00:00:00Z'), status: 'ACTIVE',
      createdAt: new Date('2026-08-09T00:00:00Z'),
    })]);
    listAlerts.mockResolvedValue([]);
    await expect(service.wallet('business-id', 'branch-id', actor))
      .resolves.toMatchObject({
        wallet: { availableCredits: 9_999 },
        lots: [{ remainingCredits: 9_999, status: 'ACTIVE' }], alerts: [],
      });
  });

  it('returns canonical branch credit history', async () => {
    listHistory.mockResolvedValue([new CreditEventEntity({
      id: 'event-id', eventType: CreditEventType.VERIFICATION_DEDUCTION,
      creditDelta: -1, balanceBefore: 10_000, balanceAfter: 9_999,
      createdAt: new Date('2026-08-09T00:00:00Z'),
    })]);
    await expect(service.history('business-id', 'branch-id', {
      eventType: CreditEventType.VERIFICATION_DEDUCTION, limit: 50, offset: 0,
    }, actor)).resolves.toMatchObject([{
      eventType: CreditEventType.VERIFICATION_DEDUCTION,
      creditDelta: -1,
    }]);
  });

  it('rejects cross-branch staff and missing wallets', async () => {
    await expect(service.wallet('business-id', 'branch-id', {
      ...actor, branchId: 'other-branch',
    })).rejects.toBeInstanceOf(ForbiddenException);
    findWallet.mockResolvedValue(undefined);
    await expect(service.wallet('business-id', 'branch-id', actor))
      .rejects.toBeInstanceOf(NotFoundException);
  });
});
