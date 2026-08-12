import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { ReceiptReviewCaseDao } from '../../src/transactions/receipt-review-case.dao';
import { ReceiptReviewCaseService } from '../../src/transactions/receipt-review-case.service';

describe('ReceiptReviewCaseService', () => {
  const list = jest.fn();
  const history = jest.fn();
  const ageingSummary = jest.fn();
  const acknowledgeWithin = jest.fn();
  const resolveWithin = jest.fn();
  const recordWithin = jest.fn();
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>, [(work: DaoTransaction) => Promise<unknown>]
  >((work) => work(boundary));
  const service = new ReceiptReviewCaseService(
    { transaction } as unknown as CentralDao,
    {
      list, history, ageingSummary, acknowledgeWithin, resolveWithin,
    } as unknown as ReceiptReviewCaseDao,
    { recordWithin } as unknown as V2AuditService,
  );
  const manager: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: 'session-id', role: 'MANAGER',
    identityType: 'BUSINESS_USER', businessIds: ['business-id'],
    branchId: 'branch-id', membershipId: 'membership-id',
    membershipRoleId: 'role-id', workAssignmentId: 'assignment-id',
  };

  beforeEach(() => jest.clearAllMocks());

  it('forces Manager queue access to the selected branch', async () => {
    list.mockResolvedValueOnce([]);
    await service.list('business-id', { limit: 50, offset: 0 }, manager);
    expect(list).toHaveBeenCalledWith(
      { businessId: 'business-id', branchId: 'branch-id' },
      { limit: 50, offset: 0 },
    );
    expect(() =>
      service.list(
        'business-id', { branchId: 'other-branch', limit: 50, offset: 0 }, manager,
      ),
    ).toThrow(ForbiddenException);
  });

  it('rejects Waiter and Platform Admin queue access', () => {
    expect(() => service.list(
      'business-id', { limit: 50, offset: 0 }, { ...manager, role: 'WAITER' },
    )).toThrow(ForbiddenException);
    expect(() => service.list(
      'business-id', { limit: 50, offset: 0 },
      { ...manager, role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN' },
    )).toThrow(ForbiddenException);
  });

  it('applies the Manager branch scope to history', async () => {
    history.mockResolvedValueOnce([]);
    await service.history('business-id', 'case-id', manager);
    expect(history).toHaveBeenCalledWith(
      { businessId: 'business-id', branchId: 'branch-id' },
      'case-id',
    );
  });

  it('applies the Manager branch scope and bounded SLA to the summary', async () => {
    ageingSummary.mockResolvedValueOnce({ totalActive: 0 });
    await service.ageingSummary(
      'business-id', { slaHours: 24 }, manager,
    );
    expect(ageingSummary).toHaveBeenCalledWith(
      { businessId: 'business-id', branchId: 'branch-id' },
      { slaHours: 24 },
    );
  });

  it('acknowledges and audits in one transaction', async () => {
    acknowledgeWithin.mockResolvedValueOnce({
      id: 'case-id', branchId: 'branch-id', status: 'ACKNOWLEDGED',
    });
    await service.acknowledge(
      'business-id', 'case-id', { note: 'Investigating' }, manager,
    );
    expect(acknowledgeWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      actorId: 'manager-id', note: 'Investigating',
    }));
    expect(recordWithin).toHaveBeenCalledWith(boundary, expect.objectContaining({
      actionType: 'RECEIPT_REVIEW_ACKNOWLEDGED',
    }));
  });

  it('requires a note for OTHER resolution', () => {
    expect(() => service.resolve(
      'business-id', 'case-id', { resolutionCode: 'OTHER' }, manager,
    )).toThrow(BadRequestException);
  });
});
