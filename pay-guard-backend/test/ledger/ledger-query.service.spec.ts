import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { LedgerQueryDao } from '../../src/ledger/ledger-query.dao';
import { LedgerQueryService } from '../../src/ledger/ledger-query.service';

describe('LedgerQueryService', () => {
  const list = jest.fn();
  const find = jest.fn();
  const projectedBalance = jest.fn();
  const service = new LedgerQueryService({
    list, find, projectedBalance,
  } as unknown as LedgerQueryDao);
  const manager: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: 'session-id', role: 'MANAGER',
    identityType: 'BUSINESS_USER', businessIds: ['business-id'],
    branchId: 'branch-id',
  };

  beforeEach(() => jest.clearAllMocks());

  it('forces Manager list access to the selected branch', async () => {
    list.mockResolvedValueOnce([]);
    await service.list('business-id', { limit: 50, offset: 0 }, manager);
    expect(list).toHaveBeenCalledWith(
      { businessId: 'business-id', branchId: 'branch-id' },
      { limit: 50, offset: 0 },
    );
  });

  it('rejects Waiter, Platform Admin and branch overrides', () => {
    expect(() => service.list(
      'business-id', { limit: 50, offset: 0 }, { ...manager, role: 'WAITER' },
    )).toThrow(ForbiddenException);
    expect(() => service.list(
      'business-id', { limit: 50, offset: 0 },
      { ...manager, identityType: 'PLATFORM_ADMIN', role: 'PLATFORM_SUPER_ADMIN' },
    )).toThrow(ForbiddenException);
    expect(() => service.list(
      'business-id', { branchId: 'other', limit: 50, offset: 0 }, manager,
    )).toThrow(ForbiddenException);
  });

  it('rejects inverted date filters', () => {
    expect(() => service.list('business-id', {
      dateFrom: '2026-08-09', dateTo: '2026-08-01', limit: 50, offset: 0,
    }, manager)).toThrow(BadRequestException);
  });

  it('conceals inaccessible entry and account existence', async () => {
    find.mockResolvedValueOnce(undefined);
    projectedBalance.mockResolvedValueOnce(undefined);
    await expect(service.require(
      'business-id', 'entry-id', manager,
    )).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.projectedBalance(
      'business-id', 'account-id', { direction: 'CREDIT', amount: '10.00' },
      manager,
    )).rejects.toBeInstanceOf(NotFoundException);
  });
});
