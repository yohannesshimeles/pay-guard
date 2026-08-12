import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { ReversalApprovalDao, ReversalAlreadyApprovedError, ReversalBalanceConflictError, ReversalNotFoundError } from '../../src/financial-operations/reversal-approval.dao';
import { ReversalApprovalService } from '../../src/financial-operations/reversal-approval.service';
import { LedgerEntryEntity } from '../../src/ledger/ledger-entry.entity';
import { LedgerEntryType } from '../../src/ledger/ledger-entry-type.enum';

describe('ReversalApprovalService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const approveWithin = jest.fn();
  const service = new ReversalApprovalService(
    { transaction } as unknown as CentralDao,
    { approveWithin } as unknown as ReversalApprovalDao,
  );
  const actor: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: '11111111-1111-4111-8111-111111111111',
    role: 'MANAGER', businessIds: ['business-id'], branchId: 'branch-id',
    identityType: 'BUSINESS_USER', membershipId: 'membership-id',
    membershipRoleId: 'role-id', workAssignmentId: 'work-id',
  };
  const input = {
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    reason: 'Manager approved compensating reversal',
    actualTransactionAt: '2026-08-08T10:00:00.000Z',
    expectedCurrentBalance: '100.00', expectedProjectedBalance: '80.00',
  };
  const reversal = new LedgerEntryEntity({
    id: 'reversal-id', businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: 'account-id', entryType: LedgerEntryType.REVERSAL,
    direction: 'DEBIT', amount: '20.00', runningBalance: '80.00',
    actualTransactionAt: new Date(input.actualTransactionAt),
    sourceRecordType: 'LEDGER_REVERSAL_APPROVAL',
    sourceRecordId: input.idempotencyKey, reversalOfEntryId: 'original-id',
    createdAt: new Date(),
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns a safe compensating entry projection', async () => {
    approveWithin.mockResolvedValue({
      approvalId: input.idempotencyKey, reversal, replayed: false,
    });
    await expect(service.approve(
      'business-id', 'branch-id', 'original-id', input, actor,
    )).resolves.toMatchObject({
      replayed: false,
      approval: {
        approvalId: input.idempotencyKey,
        originalLedgerEntryId: 'original-id', direction: 'DEBIT', amount: '20.00',
      },
    });
  });

  it('requires Manager authority and a non-future date', async () => {
    await expect(service.approve('business-id', 'branch-id', 'original-id', input, {
      ...actor, role: 'CASHIER',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.approve('business-id', 'branch-id', 'original-id', {
      ...input, actualTransactionAt: '2099-01-01T00:00:00.000Z',
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('does not hide an inaccessible or invalid original', async () => {
    approveWithin.mockRejectedValue(new ReversalNotFoundError());
    await expect(service.approve(
      'business-id', 'branch-id', 'original-id', input, actor,
    )).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a second reversal of the same original', async () => {
    approveWithin.mockRejectedValue(new ReversalAlreadyApprovedError());
    await expect(service.approve(
      'business-id', 'branch-id', 'original-id', input, actor,
    )).rejects.toThrow('already has a reversal');
  });

  it('rejects stale projected-balance confirmation', async () => {
    approveWithin.mockRejectedValue(new ReversalBalanceConflictError());
    await expect(service.approve(
      'business-id', 'branch-id', 'original-id', input, actor,
    )).rejects.toBeInstanceOf(ConflictException);
  });
});
