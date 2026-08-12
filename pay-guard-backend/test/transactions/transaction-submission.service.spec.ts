import { ConflictException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import {
  TransactionSubmissionConflictError,
  TransactionSubmissionDao,
} from '../../src/transactions/transaction-submission.dao';
import { TransactionSubmissionService } from '../../src/transactions/transaction-submission.service';

describe('TransactionSubmissionService', () => {
  const create = jest.fn<Promise<unknown>, [Record<string, unknown>]>();
  const service = new TransactionSubmissionService({
    create,
  } as unknown as TransactionSubmissionDao);
  const actor: AuthenticatedPrincipal = {
    userId: 'user-id',
    sessionId: 'session-id',
    role: 'WAITER',
    identityType: 'BUSINESS_USER',
    businessIds: ['business-id'],
    branchId: 'branch-id',
    workAssignmentId: 'assignment-id',
  };
  const input = {
    idempotencyKey: '11111111-1111-4111-8111-111111111111',
    settlementAccountId: 'account-id',
    bankId: 'bank-id',
    transactionReference: 'REF-001',
    amount: '125.50',
    transactionDate: '2026-08-08',
    transactionTime: '12:30:00',
    submissionMethod: 'QR_SCAN' as const,
  };

  beforeEach(() => jest.clearAllMocks());

  it('binds submission identity to the authenticated branch assignment', async () => {
    create.mockResolvedValueOnce({ transaction: { id: 'id' }, replayed: false });
    await service.create('business-id', 'branch-id', input, actor);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      ...input,
      businessId: 'business-id',
      branchId: 'branch-id',
      workAssignmentId: 'assignment-id',
      submittedByUserId: 'user-id',
      sessionId: 'session-id',
    }));
    const submitted = create.mock.calls[0][0] as {
      actor: { identityType: string; subjectId: string; role: string; branchId?: string };
    };
    expect(submitted.actor).toMatchObject({
      identityType: 'BUSINESS_USER', subjectId: 'user-id', role: 'WAITER',
      branchId: 'branch-id',
    });
  });

  it('rejects cross-branch submission before database access', async () => {
    await expect(
      service.create('business-id', 'other-branch', input, actor),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(create).not.toHaveBeenCalled();
  });

  it('maps changed idempotency replay to conflict', async () => {
    create.mockRejectedValueOnce(new TransactionSubmissionConflictError());
    await expect(
      service.create('business-id', 'branch-id', input, actor),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
