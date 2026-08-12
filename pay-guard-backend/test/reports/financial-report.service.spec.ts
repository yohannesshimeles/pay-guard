import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { FinancialReportDao } from '../../src/reports/financial-report.dao';
import { FinancialReportService } from '../../src/reports/financial-report.service';

describe('FinancialReportService', () => {
  const summary = jest.fn();
  const service = new FinancialReportService({ summary } as unknown as FinancialReportDao);
  const manager: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: 'session-id', role: 'MANAGER',
    identityType: 'BUSINESS_USER', businessIds: ['business-id'],
    branchId: 'branch-id',
  };
  const query = { dateFrom: '2026-08-01', dateTo: '2026-08-13' };

  beforeEach(() => jest.clearAllMocks());

  it('forces Manager reports to the authenticated branch', async () => {
    summary.mockResolvedValueOnce({ entryCount: 0 });
    await service.summary('business-id', query, manager);
    expect(summary).toHaveBeenCalledWith(
      { businessId: 'business-id', branchId: 'branch-id' }, query,
    );
  });

  it('allows an Owner to select one branch within the business', async () => {
    summary.mockResolvedValueOnce({ entryCount: 0 });
    const owner = { ...manager, role: 'PRIMARY_OWNER' as const, branchId: undefined };
    const filtered = { ...query, branchId: 'branch-id' };
    await service.summary('business-id', filtered, owner);
    expect(summary).toHaveBeenCalledWith({ businessId: 'business-id' }, filtered);
  });

  it('rejects cross-branch, cross-business, Waiter and Platform Admin access', () => {
    expect(() => service.summary(
      'business-id', { ...query, branchId: 'other-branch' }, manager,
    )).toThrow(ForbiddenException);
    expect(() => service.summary('other-business', query, manager))
      .toThrow(ForbiddenException);
    expect(() => service.summary(
      'business-id', query, { ...manager, role: 'WAITER' },
    )).toThrow(ForbiddenException);
    expect(() => service.summary('business-id', query, {
      ...manager, role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN',
    })).toThrow(ForbiddenException);
  });

  it('rejects inverted and unbounded report periods', () => {
    expect(() => service.summary('business-id', {
      dateFrom: '2026-08-13', dateTo: '2026-08-01',
    }, manager)).toThrow(BadRequestException);
    expect(() => service.summary('business-id', {
      dateFrom: '2025-01-01', dateTo: '2026-08-13',
    }, manager)).toThrow(BadRequestException);
  });
});
