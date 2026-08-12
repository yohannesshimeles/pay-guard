import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { CorrectionDao, CorrectionEvidenceError, CorrectionInsufficientBalanceError } from '../../src/financial-operations/correction.dao';
import { CorrectionEntity } from '../../src/financial-operations/correction.entity';
import { CorrectionService } from '../../src/financial-operations/correction.service';
import { CorrectionType } from '../../src/financial-operations/dto/financial-operation.dto';

describe('CorrectionService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const createWithin = jest.fn();
  const list = jest.fn();
  const find = jest.fn();
  const service = new CorrectionService(
    { transaction } as unknown as CentralDao,
    { createWithin, list, find } as unknown as CorrectionDao,
  );
  const actor: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: '11111111-1111-4111-8111-111111111111',
    role: 'MANAGER', businessIds: ['business-id'], branchId: 'branch-id',
    identityType: 'BUSINESS_USER', membershipId: 'membership-id',
    membershipRoleId: 'role-id', workAssignmentId: 'work-id',
  };
  const input = {
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    settlementAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    correctionType: CorrectionType.POSITIVE,
    amount: '20.00', reason: 'Approved reconciliation balance adjustment',
    actualTransactionAt: '2026-08-08T10:00:00.000Z',
    expectedCurrentBalance: '100.00', expectedProjectedBalance: '120.00',
  };
  const correction = new CorrectionEntity({
    id: input.idempotencyKey, businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: input.settlementAccountId,
    correctionType: input.correctionType, amount: input.amount,
    reason: input.reason, actualTransactionAt: new Date(input.actualTransactionAt),
    ledgerEntryId: 'ledger-id', runningBalance: '120.00', status: 'POSTED',
    createdAt: new Date(),
  });

  beforeEach(() => jest.clearAllMocks());

  it('posts a Manager correction only through the central transaction', async () => {
    createWithin.mockResolvedValue({ correction, replayed: false });
    await expect(service.create('business-id', 'branch-id', input, actor))
      .resolves.toMatchObject({
        replayed: false,
        correction: { correctionType: 'POSITIVE', runningBalance: '120.00' },
      });
    expect(createWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      reason: input.reason, actor,
    }));
  });

  it('requires exact Manager branch authority', async () => {
    await expect(service.create('business-id', 'branch-id', input, {
      ...actor, role: 'CASHIER',
    })).rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('rejects future dates before persistence', async () => {
    await expect(service.create('business-id', 'branch-id', {
      ...input, actualTransactionAt: '2099-01-01T00:00:00.000Z',
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects cross-scope reconciliation evidence', async () => {
    createWithin.mockRejectedValue(new CorrectionEvidenceError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toThrow('Reconciliation evidence is not valid');
  });

  it('rejects negative correction overdrafts', async () => {
    createWithin.mockRejectedValue(new CorrectionInsufficientBalanceError());
    await expect(service.create('business-id', 'branch-id', {
      ...input, correctionType: CorrectionType.NEGATIVE,
    }, actor)).rejects.toBeInstanceOf(ConflictException);
  });
});
