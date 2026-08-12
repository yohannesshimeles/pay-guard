import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { TransactionQueryDao } from '../../src/transactions/transaction-query.dao';
import { TransactionQueryService } from '../../src/transactions/transaction-query.service';

describe('TransactionQueryService', () => {
  const list = jest.fn();
  const find = jest.fn();
  const history = jest.fn();
  const verificationOutcomes = jest.fn();
  const receiptDecisions = jest.fn();
  const receiptReviewSummary = jest.fn();
  const service = new TransactionQueryService({
    list,
    find,
    history,
    verificationOutcomes,
    receiptDecisions,
    receiptReviewSummary,
  } as unknown as TransactionQueryDao);
  const owner: AuthenticatedPrincipal = {
    userId: 'owner-id',
    sessionId: 'session-id',
    role: 'PRIMARY_OWNER',
    identityType: 'BUSINESS_USER',
    businessIds: ['business-id'],
  };

  beforeEach(() => jest.clearAllMocks());

  it('allows an owner to query the selected business', async () => {
    list.mockResolvedValueOnce([]);
    await service.list(
      'business-id',
      { limit: 50, offset: 0 },
      owner,
    );
    expect(list).toHaveBeenCalledWith(
      { businessId: 'business-id' },
      { limit: 50, offset: 0 },
    );
  });

  it('forces Waiter queries to the authenticated user and branch', async () => {
    list.mockResolvedValueOnce([]);
    await service.list(
      'business-id',
      { limit: 50, offset: 0 },
      {
        ...owner,
        userId: 'waiter-id',
        role: 'WAITER',
        branchId: 'branch-id',
      },
    );
    expect(list).toHaveBeenCalledWith(
      {
        businessId: 'business-id',
        branchId: 'branch-id',
        submittedByUserId: 'waiter-id',
      },
      { limit: 50, offset: 0 },
    );
  });

  it('rejects cross-business and branch-scope overrides', async () => {
    await expect(
      service.list('other-business', { limit: 50, offset: 0 }, owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.list(
        'business-id',
        { branchId: 'other-branch', limit: 50, offset: 0 },
        { ...owner, role: 'MANAGER', branchId: 'branch-id' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects inverted date ranges before querying', async () => {
    await expect(
      service.list(
        'business-id',
        {
          dateFrom: '2026-08-07',
          dateTo: '2026-08-06',
          limit: 50,
          offset: 0,
        },
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns not found for records outside the effective scope', async () => {
    find.mockResolvedValueOnce(undefined);
    history.mockResolvedValueOnce(undefined);
    verificationOutcomes.mockResolvedValueOnce(undefined);
    await expect(
      service.require('business-id', 'transaction-id', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.history('business-id', 'transaction-id', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.verificationOutcomes('business-id', 'transaction-id', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('uses the same Waiter scope for sanitized verification outcomes', async () => {
    verificationOutcomes.mockResolvedValueOnce([]);
    await service.verificationOutcomes(
      'business-id', 'transaction-id', {
        ...owner, userId: 'waiter-id', role: 'WAITER', branchId: 'branch-id',
      },
    );
    expect(verificationOutcomes).toHaveBeenCalledWith('transaction-id', {
      businessId: 'business-id', branchId: 'branch-id',
      submittedByUserId: 'waiter-id',
    });
  });

  it('requires a real platform identity for the Super Admin role', async () => {
    await expect(
      service.list(
        'business-id',
        { limit: 50, offset: 0 },
        {
          ...owner,
          role: 'PLATFORM_SUPER_ADMIN',
          identityType: 'BUSINESS_USER',
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('uses the same Waiter and branch scope for decision history and counts', async () => {
    const waiter = {
      ...owner,
      userId: 'waiter-id',
      role: 'WAITER' as const,
      branchId: 'branch-id',
    };
    receiptDecisions.mockResolvedValueOnce([]);
    receiptReviewSummary.mockResolvedValueOnce({ total: 0 });
    await service.receiptDecisions('business-id', 'transaction-id', waiter);
    await service.receiptReviewSummary(
      'business-id',
      { dateFrom: '2026-08-01', dateTo: '2026-08-08' },
      waiter,
    );
    const scope = {
      businessId: 'business-id',
      branchId: 'branch-id',
      submittedByUserId: 'waiter-id',
    };
    expect(receiptDecisions).toHaveBeenCalledWith('transaction-id', scope);
    expect(receiptReviewSummary).toHaveBeenCalledWith(scope, {
      dateFrom: '2026-08-01',
      dateTo: '2026-08-08',
    });
  });

  it('conceals out-of-scope decision history and rejects count overrides', async () => {
    receiptDecisions.mockResolvedValueOnce(undefined);
    await expect(
      service.receiptDecisions('business-id', 'transaction-id', owner),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.receiptReviewSummary(
        'business-id',
        { branchId: 'other-branch' },
        { ...owner, role: 'MANAGER', branchId: 'branch-id' },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
