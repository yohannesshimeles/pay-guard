import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { PasswordService } from '../../src/auth/password.service';
import { DatabaseService } from '../../src/database/database.service';
import { V2UsersService } from '../../src/users/v2-users.service';

describe('V2UsersService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (value: typeof client) => unknown) =>
      Promise.resolve(work(client)),
    ),
  };
  const passwords = { hash: jest.fn() };
  const audit = { recordWithClient: jest.fn() };
  const service = new V2UsersService(
    database as unknown as DatabaseService,
    passwords as unknown as PasswordService,
    audit as unknown as V2AuditService,
  );
  const owner = {
    userId: 'owner-1',
    sessionId: 'owner-session-1',
    identityType: 'BUSINESS_USER' as const,
    role: 'PRIMARY_OWNER' as const,
    businessIds: ['business-1'],
    membershipId: 'owner-membership-1',
    membershipRoleId: 'owner-role-1',
  };
  const staff = {
    id: 'staff-1',
    full_name: 'Test Cashier',
    email: 'cashier@example.test',
    phone_number: '+251911000020',
    global_status: 'ACTIVE',
    membership_id: 'membership-1',
    membership_status: 'ACTIVE',
    membership_role_id: 'role-1',
    role_code: 'CASHIER',
    role_status: 'ACTIVE',
    work_assignment_id: 'assignment-1',
    assignment_status: 'ACTIVE',
    branch_id: 'branch-1',
    assigned_at: new Date('2026-08-05T00:00:00.000Z'),
    removed_at: null,
    removal_reason: null,
    created_at: new Date('2026-08-05T00:00:00.000Z'),
  };
  const input = {
    fullName: 'Test Cashier',
    email: 'cashier@example.test',
    phone: '+251911000020',
    temporaryPassword: 'Temporary-Password!',
    role: 'CASHIER' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    passwords.hash.mockResolvedValue('password-hash');
    audit.recordWithClient.mockResolvedValue(undefined);
  });

  it('requires full name and phone for the V2 identity', async () => {
    await expect(
      service.createStaff(
        'business-1',
        'branch-1',
        {
          email: 'cashier@example.test',
          temporaryPassword: 'Temporary-Password!',
          role: 'CASHIER',
        },
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(passwords.hash).not.toHaveBeenCalled();
  });

  it('creates identity, membership, role, assignment and audit atomically', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'staff-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'membership-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'role-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'assignment-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [staff] });

    await expect(
      service.createStaff('business-1', 'branch-1', input, owner),
    ).resolves.toMatchObject({
      id: 'staff-1',
      role: 'CASHIER',
      branchId: 'branch-1',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'BRANCH'"),
      ['role-1', 'business-1', 'branch-1', 'owner-role-1'],
    );
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        actionType: 'STAFF_CREATED',
        businessId: 'business-1',
        branchId: 'branch-1',
      }),
    );
  });

  it('rejects a business identifier outside the Owner principal', async () => {
    await expect(
      service.list('business-2', 'branch-1', owner),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(database.query).not.toHaveBeenCalled();
  });

  it('lists only the requested business and branch assignment', async () => {
    database.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [staff] });
    await expect(
      service.list('business-1', 'branch-1', owner),
    ).resolves.toEqual([expect.objectContaining({ id: 'staff-1' })]);
    expect(database.query).toHaveBeenLastCalledWith(expect.any(String), [
      'business-1',
      'branch-1',
      false,
    ]);
  });

  it('prevents removal of the final active Manager in a branch', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ ...staff, role_code: 'MANAGER' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ count: '1' }] });
    await expect(
      service.remove(
        'business-1',
        'branch-1',
        'staff-1',
        { reason: 'Employment ended' },
        owner,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(audit.recordWithClient).not.toHaveBeenCalled();
  });

  it('removes only the target assignment and revokes its sessions atomically', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [staff] })
      .mockResolvedValue({ rowCount: 1, rows: [] });
    await expect(
      service.remove(
        'business-1',
        'branch-1',
        'staff-1',
        { reason: 'Employment ended' },
        owner,
      ),
    ).resolves.toEqual({
      id: 'staff-1',
      businessId: 'business-1',
      branchId: 'branch-1',
      status: 'REMOVED',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE work_assignment_id = $1'),
      ['assignment-1'],
    );
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ actionType: 'STAFF_REMOVED' }),
    );
  });
});
