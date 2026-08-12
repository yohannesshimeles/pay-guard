import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { OperationalReportDao } from '../../src/reports/operational-report.dao';
import { OperationalReportService } from '../../src/reports/operational-report.service';

describe('OperationalReportService', () => {
  const businessSummary = jest.fn();
  const providerSummary = jest.fn();
  const service = new OperationalReportService({
    businessSummary, providerSummary,
  } as unknown as OperationalReportDao);
  const manager: AuthenticatedPrincipal = {
    userId: 'manager-id', sessionId: 'session-id', role: 'MANAGER',
    identityType: 'BUSINESS_USER', businessIds: ['business-id'],
    branchId: 'branch-id',
  };
  const range = { dateFrom: '2026-08-01', dateTo: '2026-08-13' };

  beforeEach(() => jest.clearAllMocks());

  it('forces business operations to the authenticated Manager branch', async () => {
    businessSummary.mockResolvedValueOnce({});
    await service.businessSummary('business-id', range, manager);
    expect(businessSummary).toHaveBeenCalledWith(
      { businessId: 'business-id', branchId: 'branch-id' }, range,
    );
    expect(() => service.businessSummary('business-id', {
      ...range, branchId: 'other-branch',
    }, manager)).toThrow(ForbiddenException);
  });

  it('rejects Waiters, outsiders and Platform Admins from business reports', () => {
    expect(() => service.businessSummary(
      'business-id', range, { ...manager, role: 'WAITER' },
    )).toThrow(ForbiddenException);
    expect(() => service.businessSummary('other-business', range, manager))
      .toThrow(ForbiddenException);
    expect(() => service.businessSummary('business-id', range, {
      ...manager, role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN',
    })).toThrow(ForbiddenException);
  });

  it('isolates provider health to a Platform Super Admin', async () => {
    providerSummary.mockResolvedValueOnce({});
    const admin: AuthenticatedPrincipal = {
      userId: 'admin-id', sessionId: 'session-id', role: 'PLATFORM_SUPER_ADMIN',
      identityType: 'PLATFORM_ADMIN', businessIds: [],
    };
    await service.providerSummary(range, admin);
    expect(providerSummary).toHaveBeenCalledWith(range);
    expect(() => service.providerSummary(range, manager))
      .toThrow(ForbiddenException);
  });

  it('bounds business and provider reporting periods', () => {
    const owner = { ...manager, role: 'PRIMARY_OWNER' as const };
    expect(() => service.businessSummary('business-id', {
      dateFrom: '2026-08-13', dateTo: '2026-08-01',
    }, owner)).toThrow(BadRequestException);
    expect(() => service.providerSummary({
      dateFrom: '2026-01-01', dateTo: '2026-08-13',
    }, {
      userId: 'admin-id', sessionId: 'session-id',
      role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN', businessIds: [],
    })).toThrow(BadRequestException);
  });
});
