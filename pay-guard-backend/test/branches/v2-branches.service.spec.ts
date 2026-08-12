import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { V2BranchesService } from '../../src/branches/v2-branches.service';
import { DatabaseService } from '../../src/database/database.service';

describe('V2BranchesService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (value: typeof client) => unknown) =>
      Promise.resolve(work(client)),
    ),
  };
  const audit = { recordWithClient: jest.fn() };
  const service = new V2BranchesService(
    database as unknown as DatabaseService,
    audit as unknown as V2AuditService,
  );
  const owner = {
    userId: 'owner-1',
    sessionId: 'session-1',
    identityType: 'BUSINESS_USER' as const,
    role: 'PRIMARY_OWNER' as const,
    businessIds: ['business-1'],
    membershipId: 'membership-1',
    membershipRoleId: 'role-1',
  };
  const row = {
    id: 'branch-1',
    branch_code: 'BR-001',
    business_id: 'business-1',
    branch_name: 'Bole Branch',
    address: 'Bole Road',
    city: 'Addis Ababa',
    sub_city: 'Bole',
    woreda: '03',
    location_details: 'Near the airport',
    settlement_mode: 'MAIN_BUSINESS_ALL',
    status: 'SETUP_REQUIRED',
    created_by_membership_id: 'membership-1',
    created_at: new Date('2026-08-05T00:00:00.000Z'),
    activated_at: null,
  };
  const createInput = {
    name: 'Bole Branch',
    code: 'BR-001',
    address: 'Bole Road',
    city: 'Addis Ababa',
    subCity: 'Bole',
    woreda: '03',
    locationDetails: 'Near the airport',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    audit.recordWithClient.mockResolvedValue(undefined);
  });

  it('requires every V2 branch field before opening a transaction', async () => {
    await expect(
      service.create('business-1', { name: 'Incomplete' }, owner),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('creates a branch and audit record in the authenticated Owner tenant', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [row] });

    await expect(
      service.create('business-1', createInput, owner),
    ).resolves.toMatchObject({
      id: 'branch-1',
      code: 'BR-001',
      status: 'SETUP_REQUIRED',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('created_by_membership_id'),
      expect.arrayContaining(['business-1', 'membership-1']),
    );
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        actionType: 'BRANCH_CREATED',
        businessId: 'business-1',
        branchId: 'branch-1',
      }),
    );
  });

  it('rejects branch creation by a Platform Admin without impersonating an Owner', async () => {
    await expect(
      service.create('business-1', createInput, {
        userId: 'admin-1',
        sessionId: 'admin-session-1',
        identityType: 'PLATFORM_ADMIN',
        role: 'PLATFORM_SUPER_ADMIN',
        businessIds: [],
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('binds branch-scoped staff listings to their authenticated branch', async () => {
    database.query.mockResolvedValueOnce({ rows: [row] });
    await service.list('business-1', {
      ...owner,
      role: 'MANAGER',
      branchId: 'branch-1',
    });
    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      'business-1',
      'branch-1',
    ]);
  });

  it('rejects cross-business access before querying', async () => {
    await expect(service.list('business-2', owner)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(database.query).not.toHaveBeenCalled();
  });

  it('requires an active business before updating a branch', async () => {
    client.query.mockResolvedValueOnce({ rowCount: 0, rows: [] });
    await expect(
      service.update(
        'business-1',
        'branch-1',
        { name: 'Updated Branch' },
        owner,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(audit.recordWithClient).not.toHaveBeenCalled();
  });
});
