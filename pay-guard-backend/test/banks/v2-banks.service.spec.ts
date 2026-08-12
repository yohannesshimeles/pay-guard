import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { V2BanksService } from '../../src/banks/v2-banks.service';
import { AccountCryptoService } from '../../src/common/account-crypto.service';
import { DatabaseService } from '../../src/database/database.service';

describe('V2BanksService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (value: typeof client) => unknown) =>
      Promise.resolve(work(client)),
    ),
  };
  const crypto = { encrypt: jest.fn() };
  const audit = { recordWithClient: jest.fn() };
  const service = new V2BanksService(
    database as unknown as DatabaseService,
    crypto as unknown as AccountCryptoService,
    audit as unknown as V2AuditService,
  );
  const owner = {
    userId: 'owner-1',
    sessionId: 'owner-session-1',
    identityType: 'BUSINESS_USER' as const,
    role: 'PRIMARY_OWNER' as const,
    businessIds: ['business-1'],
    membershipId: 'membership-1',
    membershipRoleId: 'role-1',
  };
  const admin = {
    userId: 'admin-1',
    sessionId: 'admin-session-1',
    identityType: 'PLATFORM_ADMIN' as const,
    role: 'PLATFORM_SUPER_ADMIN' as const,
    businessIds: [],
  };
  const account = {
    id: 'account-1',
    business_id: 'business-1',
    scope_type: 'BRANCH',
    branch_id: 'branch-1',
    bank_id: 'bank-1',
    official_name: 'Commercial Bank',
    short_name: 'CBE',
    account_name: 'Operations Account',
    masked_account_number: '********4567',
    normalized_account_suffix: '12344567',
    opening_balance: '100.00',
    opening_balance_date: '2026-08-05',
    calculated_balance: '100.00',
    currency: 'ETB',
    status: 'ACTIVE',
    version_no: 1,
    created_at: new Date('2026-08-05T00:00:00.000Z'),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    crypto.encrypt.mockReturnValue({
      ciphertext: 'ciphertext',
      iv: 'iv',
      authTag: 'tag',
      mask: '********4567',
      suffix: '12344567',
      fingerprint: 'a'.repeat(64),
    });
    audit.recordWithClient.mockResolvedValue(undefined);
  });

  it('only exposes disabled banks to the Platform Admin', async () => {
    database.query.mockResolvedValue({ rows: [] });
    await service.listBanks(true, owner);
    expect(database.query).toHaveBeenCalledWith(expect.any(String), [false]);
    await service.listBanks(true, admin);
    expect(database.query).toHaveBeenLastCalledWith(expect.any(String), [true]);
  });

  it('rejects branch account creation without an Owner context', async () => {
    await expect(
      service.createBranchAccount(
        'business-1',
        'branch-1',
        {
          bankId: 'bank-1',
          accountName: 'Operations Account',
          accountValue: '1234567',
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('stores an encrypted envelope and keyed fingerprint atomically', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [account] });
    await expect(
      service.createBranchAccount(
        'business-1',
        'branch-1',
        {
          bankId: 'bank-1',
          accountName: 'Operations Account',
          accountValue: '1234567',
          openingBalance: 100,
          openingBalanceDate: '2026-08-05',
        },
        owner,
      ),
    ).resolves.toMatchObject({
      id: 'account-1',
      accountMask: '********4567',
      active: true,
    });
    expect(client.query).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      expect.arrayContaining([expect.any(Buffer), 'a'.repeat(64)]),
    );
    expect(client.query).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['1234567']),
    );
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        actionType: 'SETTLEMENT_ACCOUNT_CREATED',
        businessId: 'business-1',
        branchId: 'branch-1',
      }),
    );
  });

  it('maps the database-wide fingerprint collision to a conflict', async () => {
    client.query
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ '?column?': 1 }] })
      .mockRejectedValueOnce({ code: '23505' });
    await expect(
      service.createBranchAccount(
        'business-1',
        'branch-1',
        {
          bankId: 'bank-1',
          accountName: 'Duplicate Account',
          accountValue: '1234567',
        },
        owner,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('deactivates an account only inside its exact tenant and branch', async () => {
    client.query.mockResolvedValueOnce({ rowCount: 1, rows: [
      { ...account, status: 'INACTIVE' },
    ] });
    await expect(
      service.deactivateBranchAccount(
        'business-1',
        'branch-1',
        'account-1',
        owner,
      ),
    ).resolves.toEqual({
      id: 'account-1',
      active: false,
      status: 'INACTIVE',
    });
    expect(client.query).toHaveBeenCalledWith(expect.any(String), [
      'account-1',
      'business-1',
      'branch-1',
    ]);
  });

  it('rejects legacy-only platform account fields in V2 mode', async () => {
    await expect(
      service.createPlatformAccount(
        {
          bankId: 'bank-1',
          accountName: 'Platform Account',
          accountValue: '7654321',
          isDefault: true,
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(crypto.encrypt).not.toHaveBeenCalled();
  });
});
