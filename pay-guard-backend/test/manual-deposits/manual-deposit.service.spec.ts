import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { ManualDepositEntity } from '../../src/manual-deposits/manual-deposit.entity';
import {
  ManualDepositBalanceConflictError,
  ManualDepositDao,
} from '../../src/manual-deposits/manual-deposit.dao';
import { ManualDepositService } from '../../src/manual-deposits/manual-deposit.service';

describe('ManualDepositService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const createWithin = jest.fn();
  const list = jest.fn();
  const find = jest.fn();
  const service = new ManualDepositService(
    { transaction } as unknown as CentralDao,
    { createWithin, list, find } as unknown as ManualDepositDao,
  );
  const actor: AuthenticatedPrincipal = {
    userId: 'user-id', sessionId: '11111111-1111-4111-8111-111111111111',
    role: 'CASHIER', businessIds: ['business-id'], branchId: 'branch-id',
    identityType: 'BUSINESS_USER', membershipId: 'membership-id',
    membershipRoleId: 'role-id', workAssignmentId: 'work-id',
  };
  const input = {
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    settlementAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    amount: '25.50', description: 'Counter cash deposit',
    actualTransactionAt: '2026-08-08T10:00:00.000Z',
    expectedCurrentBalance: '100.00', expectedProjectedBalance: '125.50',
  };
  const deposit = new ManualDepositEntity({
    id: input.idempotencyKey, businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: input.settlementAccountId, amount: '25.50',
    description: input.description,
    actualTransactionAt: new Date(input.actualTransactionAt),
    cashierRoleAssignmentId: 'role-id', ledgerEntryId: 'ledger-id',
    runningBalance: '125.50', status: 'POSTED',
    createdAt: new Date('2026-08-09T10:01:00.000Z'),
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates only through the central transaction and returns replay state', async () => {
    createWithin.mockResolvedValue({ deposit, replayed: false });
    await expect(service.create('business-id', 'branch-id', input, actor))
      .resolves.toMatchObject({
        replayed: false,
        deposit: { amount: '25.50', runningBalance: '125.50', currency: 'ETB' },
      });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      id: input.idempotencyKey,
      actualTransactionAt: new Date(input.actualTransactionAt),
      actor,
    }));
  });

  it('rejects future-dated deposits before database access', async () => {
    await expect(service.create('business-id', 'branch-id', {
      ...input, actualTransactionAt: '2099-01-01T00:00:00.000Z',
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires an exact active Cashier branch context', async () => {
    await expect(service.create('business-id', 'branch-id', input, {
      ...actor, branchId: 'other-branch',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps stale projected-balance confirmation to conflict', async () => {
    createWithin.mockRejectedValue(new ManualDepositBalanceConflictError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects an inverted list date range', () => {
    expect(() => service.list('business-id', 'branch-id', {
      dateFrom: '2026-08-10', dateTo: '2026-08-09', limit: 50, offset: 0,
    }, actor)).toThrow(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });
});
