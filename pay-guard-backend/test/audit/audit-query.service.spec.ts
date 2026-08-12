import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AuditQueryDao } from '../../src/audit/audit-query.dao';
import { AuditQueryService } from '../../src/audit/audit-query.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';

describe('AuditQueryService', () => {
  const queries = { list: jest.fn() };
  const service = new AuditQueryService(queries as unknown as AuditQueryDao);
  const owner: AuthenticatedPrincipal = {
    userId: 'user-1', sessionId: 'session-1', role: 'PRIMARY_OWNER',
    identityType: 'BUSINESS_USER', businessIds: ['business-1'],
  };

  beforeEach(() => {
    jest.clearAllMocks();
    queries.list.mockResolvedValue({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it('limits a Manager to the branch selected in the access token', async () => {
    const manager: AuthenticatedPrincipal = {
      ...owner, role: 'MANAGER', branchId: 'branch-1',
    };
    await service.business('business-1', {
      branchId: 'branch-1', limit: 50, offset: 0,
    }, manager);
    expect(queries.list).toHaveBeenCalledWith({
      platform: false, businessId: 'business-1', branchId: 'branch-1',
    }, expect.any(Object));
  });

  it('rejects branch and tenant overrides', () => {
    const manager: AuthenticatedPrincipal = {
      ...owner, role: 'MANAGER', branchId: 'branch-1',
    };
    expect(() => service.business('business-1', {
      branchId: 'branch-2', limit: 50, offset: 0,
    }, manager)).toThrow(ForbiddenException);
    expect(() => service.business('business-1', {
      businessId: 'business-2', limit: 50, offset: 0,
    }, owner)).toThrow(ForbiddenException);
  });

  it('allows only an isolated Platform Super Admin to query platform audit', async () => {
    expect(() => service.platform({ limit: 50, offset: 0 }, owner))
      .toThrow(ForbiddenException);
    const admin: AuthenticatedPrincipal = {
      userId: 'admin-1', sessionId: 'admin-session-1',
      role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN', businessIds: [],
    };
    await service.platform({ businessId: 'business-1', limit: 50, offset: 0 }, admin);
    expect(queries.list).toHaveBeenCalledWith({ platform: true }, expect.any(Object));
  });

  it('rejects inverted and excessive date ranges', () => {
    expect(() => service.business('business-1', {
      dateFrom: '2026-08-02', dateTo: '2026-08-01', limit: 50, offset: 0,
    }, owner)).toThrow(BadRequestException);
    expect(() => service.business('business-1', {
      dateFrom: '2024-01-01', dateTo: '2026-01-02', limit: 50, offset: 0,
    }, owner)).toThrow(BadRequestException);
  });
});
