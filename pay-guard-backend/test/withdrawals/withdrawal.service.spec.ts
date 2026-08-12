import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { WithdrawalEntity } from '../../src/withdrawals/withdrawal.entity';
import {
  WithdrawalBalanceConflictError,
  WithdrawalDao,
  WithdrawalInsufficientBalanceError,
  WithdrawalReplayConflictError,
} from '../../src/withdrawals/withdrawal.dao';
import { WithdrawalService } from '../../src/withdrawals/withdrawal.service';

describe('WithdrawalService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const createWithin = jest.fn();
  const list = jest.fn();
  const find = jest.fn();
  const service = new WithdrawalService(
    { transaction } as unknown as CentralDao,
    { createWithin, list, find } as unknown as WithdrawalDao,
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
    amount: '25.50', recipientName: 'Abebe Bekele',
    recipientBankName: 'Commercial Bank of Ethiopia',
    description: 'Cash withdrawal for approved supplies',
    actualTransactionAt: '2026-08-08T10:00:00.000Z',
    expectedCurrentBalance: '100.00', expectedProjectedBalance: '74.50',
  };
  const withdrawal = new WithdrawalEntity({
    id: input.idempotencyKey, businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: input.settlementAccountId, amount: input.amount,
    recipientName: input.recipientName,
    recipientBankName: input.recipientBankName,
    description: input.description,
    actualTransactionAt: new Date(input.actualTransactionAt),
    recordedByRoleAssignmentId: 'role-id', ledgerEntryId: 'ledger-id',
    runningBalance: '74.50', status: 'POSTED', createdAt: new Date(),
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates only inside the central transaction and exposes the debit balance', async () => {
    createWithin.mockResolvedValue({ withdrawal, replayed: false });
    await expect(service.create('business-id', 'branch-id', input, actor))
      .resolves.toMatchObject({
        replayed: false,
        withdrawal: { amount: '25.50', runningBalance: '74.50', currency: 'ETB' },
      });
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(createWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      id: input.idempotencyKey, recipientName: 'Abebe Bekele', actor,
    }));
  });

  it('rejects future timestamps and wrong branch context before database access', async () => {
    await expect(service.create('business-id', 'branch-id', {
      ...input, actualTransactionAt: '2099-01-01T00:00:00.000Z',
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create('business-id', 'branch-id', input, {
      ...actor, branchId: 'other-branch',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('maps stale projected balance to conflict', async () => {
    createWithin.mockRejectedValue(new WithdrawalBalanceConflictError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('maps insufficient balance to conflict without accepting an overdraft', async () => {
    createWithin.mockRejectedValue(new WithdrawalInsufficientBalanceError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toThrow('Insufficient calculated settlement balance');
  });

  it('maps changed idempotency reuse to conflict', async () => {
    createWithin.mockRejectedValue(new WithdrawalReplayConflictError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toThrow('Withdrawal idempotency conflict');
  });

  it('rejects inverted history dates', () => {
    expect(() => service.list('business-id', 'branch-id', {
      dateFrom: '2026-08-10', dateTo: '2026-08-09', limit: 50, offset: 0,
    }, actor)).toThrow(BadRequestException);
    expect(list).not.toHaveBeenCalled();
  });
});
