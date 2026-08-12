import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  ReconciliationDao,
  ReconciliationDecisionConflictError,
  ReconciliationExplanationRequiredError,
  ReconciliationReplayConflictError,
  ReconciliationScheduleNotFoundError,
} from '../../src/reconciliations/reconciliation.dao';
import { ReconciliationEntity } from '../../src/reconciliations/reconciliation.entity';
import { ReconciliationService } from '../../src/reconciliations/reconciliation.service';

describe('ReconciliationService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary),
  );
  const createWithin = jest.fn();
  const submitWithin = jest.fn();
  const decideWithin = jest.fn();
  const list = jest.fn();
  const find = jest.fn();
  const history = jest.fn();
  const service = new ReconciliationService(
    { transaction } as unknown as CentralDao,
    { createWithin, submitWithin, decideWithin, list, find, history } as unknown as ReconciliationDao,
  );
  const actor: AuthenticatedPrincipal = {
    userId: 'cashier-id', sessionId: '11111111-1111-4111-8111-111111111111',
    role: 'CASHIER', businessIds: ['business-id'], branchId: 'branch-id',
    identityType: 'BUSINESS_USER', membershipId: 'membership-id',
    membershipRoleId: 'role-id', workAssignmentId: 'work-id',
  };
  const input = {
    idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    settlementAccountId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    reconciliationDate: '2026-08-08', actualBankBalance: '120.00',
    description: 'Daily branch settlement reconciliation',
  };
  const manager: AuthenticatedPrincipal = {
    ...actor, userId: 'manager-id', role: 'MANAGER',
    membershipRoleId: 'manager-role-id', workAssignmentId: 'manager-work-id',
  };
  const reconciliation = new ReconciliationEntity({
    id: input.idempotencyKey, businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: input.settlementAccountId,
    reconciliationDate: input.reconciliationDate, closingTime: '17:00:00',
    openingBalance: '100.00', verifiedDepositsTotal: '20.00',
    manualDepositsTotal: '10.00', withdrawalsTotal: '5.00',
    positiveCorrectionsTotal: '0.00', negativeCorrectionsTotal: '0.00',
    reversalsNetTotal: '-5.00', calculatedBalance: '120.00',
    actualBankBalance: '120.00', difference: '0.00',
    description: input.description, status: 'DRAFT', sequenceNo: 1,
    createdAt: new Date(),
  });

  beforeEach(() => jest.clearAllMocks());

  it('creates an immutable categorized draft through one central transaction', async () => {
    createWithin.mockResolvedValue({ reconciliation, replayed: false });
    await expect(service.create('business-id', 'branch-id', input, actor))
      .resolves.toMatchObject({
        replayed: false,
        reconciliation: {
          status: 'DRAFT', calculatedBalance: '120.00',
          totals: { manualDeposits: '10.00', withdrawals: '5.00' },
        },
      });
    expect(createWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      id: input.idempotencyKey, actor,
    }));
  });

  it('requires a Cashier in the exact branch and rejects future dates', async () => {
    await expect(service.create('business-id', 'branch-id', input, {
      ...actor, branchId: 'other-branch',
    })).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.create('business-id', 'branch-id', {
      ...input, reconciliationDate: '2099-01-01',
    }, actor)).rejects.toBeInstanceOf(BadRequestException);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires an active branch schedule', async () => {
    createWithin.mockRejectedValue(new ReconciliationScheduleNotFoundError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires explanation when actual and calculated balances differ', async () => {
    createWithin.mockRejectedValue(new ReconciliationExplanationRequiredError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toThrow('difference explanation is required');
  });

  it('rejects changed idempotency replay', async () => {
    createWithin.mockRejectedValue(new ReconciliationReplayConflictError());
    await expect(service.create('business-id', 'branch-id', input, actor))
      .rejects.toBeInstanceOf(ConflictException);
  });

  it('submits the Cashier draft and returns automatic classification', async () => {
    const matched = new ReconciliationEntity({
      ...reconciliation.toPublicModel(),
      businessId: 'business-id', branchId: 'branch-id',
      closingTime: '17:00:00',
      openingBalance: '100.00', verifiedDepositsTotal: '20.00',
      manualDepositsTotal: '10.00', withdrawalsTotal: '5.00',
      positiveCorrectionsTotal: '0.00', negativeCorrectionsTotal: '0.00',
      reversalsNetTotal: '-5.00', status: 'MATCHED', sequenceNo: 1,
      actualTransactionAt: undefined,
    } as never);
    submitWithin.mockResolvedValue({ reconciliation: matched, replayed: false });
    await expect(service.submit(
      'business-id', 'branch-id', input.idempotencyKey, actor,
    )).resolves.toMatchObject({
      replayed: false, reconciliation: { status: 'MATCHED' },
    });
  });

  it('returns detail with sanitized immutable history', async () => {
    find.mockResolvedValue(reconciliation);
    history.mockResolvedValue([{ toStatus: 'DRAFT', reason: 'Draft created' }]);
    await expect(service.require(
      'business-id', 'branch-id', input.idempotencyKey, actor,
    )).resolves.toMatchObject({
      id: input.idempotencyKey,
      history: [{ toStatus: 'DRAFT', reason: 'Draft created' }],
    });
  });

  it('allows an exact-branch Manager to approve with a meaningful reason', async () => {
    const approved = new ReconciliationEntity({
      ...reconciliation.toPublicModel(),
      openingBalance: '100.00', verifiedDepositsTotal: '20.00',
      manualDepositsTotal: '10.00', withdrawalsTotal: '5.00',
      positiveCorrectionsTotal: '0.00', negativeCorrectionsTotal: '0.00',
      reversalsNetTotal: '-5.00', status: 'APPROVED', sequenceNo: 1,
      decisionReason: 'Manager verified the bank statement evidence',
      decidedAt: new Date(),
    } as never);
    decideWithin.mockResolvedValue({ reconciliation: approved, replayed: false });
    await expect(service.decide(
      'business-id', 'branch-id', input.idempotencyKey,
      { decision: 'APPROVED', reason: '  Manager verified the bank statement evidence  ' },
      manager,
    )).resolves.toMatchObject({
      replayed: false,
      reconciliation: { status: 'APPROVED' },
    });
    expect(decideWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      decision: 'APPROVED',
      reason: 'Manager verified the bank statement evidence',
      actor: manager,
    }));
  });

  it('rejects cross-branch Managers and conflicting repeated decisions', async () => {
    await expect(service.decide(
      'business-id', 'branch-id', input.idempotencyKey,
      { decision: 'RETURNED', reason: 'Supporting bank evidence must be corrected' },
      { ...manager, branchId: 'other-branch' },
    )).rejects.toBeInstanceOf(ForbiddenException);
    decideWithin.mockRejectedValue(new ReconciliationDecisionConflictError());
    await expect(service.decide(
      'business-id', 'branch-id', input.idempotencyKey,
      { decision: 'RETURNED', reason: 'Supporting bank evidence must be corrected' },
      manager,
    )).rejects.toBeInstanceOf(ConflictException);
  });
});
