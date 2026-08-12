import {
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { PasswordService } from '../../src/auth/password.service';
import { DatabaseService } from '../../src/database/database.service';
import { V2BusinessesService } from '../../src/businesses/v2-businesses.service';

describe('V2BusinessesService', () => {
  const client = { query: jest.fn() };
  const database = {
    query: jest.fn(),
    transaction: jest.fn((work: (value: typeof client) => unknown) =>
      Promise.resolve(work(client)),
    ),
  };
  const passwords = { hash: jest.fn() };
  const audit = { recordWithClient: jest.fn() };
  const service = new V2BusinessesService(
    database as unknown as DatabaseService,
    passwords as unknown as PasswordService,
    audit as unknown as V2AuditService,
  );
  const businessRow = {
    id: 'business-1',
    business_code: 'PG-001',
    legal_name: 'PayGuard Test Business',
    category_id: 'category-1',
    category_name: 'Coffee House',
    custom_category: null,
    tin: 'TIN-001',
    phone: '+251911000001',
    email: 'owner@example.test',
    address: 'Test address',
    city: 'Addis Ababa',
    status: 'REGISTRATION',
    registration_at: new Date('2026-08-05T00:00:00.000Z'),
    activation_at: null,
    created_at: new Date('2026-08-05T00:00:00.000Z'),
  };
  const registration = {
    name: 'PayGuard Test Business',
    businessCode: 'PG-001',
    categoryId: 'category-1',
    tin: 'TIN-001',
    businessPhone: '+251911000001',
    address: 'Test address',
    city: 'Addis Ababa',
    ownerFullName: 'Primary Owner',
    ownerEmail: 'owner@example.test',
    ownerPhone: '+251911000002',
    password: 'private-password',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    passwords.hash.mockResolvedValue('password-hash');
    audit.recordWithClient.mockResolvedValue(undefined);
  });

  it('requires every V2 registration field before writing', async () => {
    await expect(
      service.register({
        name: 'Incomplete Business',
        ownerEmail: 'owner@example.test',
        password: 'private-password',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it('creates pending owner tenancy and audit atomically', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [{ is_other: false }] })
      .mockResolvedValueOnce({ rows: [{ id: 'owner-1' }] })
      .mockResolvedValueOnce({ rows: [businessRow] })
      .mockResolvedValueOnce({ rows: [{ id: 'membership-1' }] })
      .mockResolvedValueOnce({ rows: [{ id: 'role-1' }] });

    await expect(service.register(registration)).resolves.toMatchObject({
      id: 'business-1',
      businessCode: 'PG-001',
      status: 'REGISTRATION',
    });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("'PRIMARY_OWNER', 'PENDING'"),
      ['membership-1'],
    );
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ actionType: 'BUSINESS_REGISTERED' }),
    );
  });

  it('limits business listings to the authenticated tenant scope', async () => {
    database.query.mockResolvedValueOnce({ rows: [businessRow] });

    await service.list({
      userId: 'owner-1',
      sessionId: 'session-1',
      identityType: 'BUSINESS_USER',
      role: 'PRIMARY_OWNER',
      businessIds: ['business-1'],
    });

    expect(database.query).toHaveBeenCalledWith(expect.any(String), [
      false,
      ['business-1'],
    ]);
  });

  it('rejects status review by a business user', async () => {
    await expect(
      service.changeStatus(
        'business-1',
        { status: 'ACTIVE' },
        {
          userId: 'owner-1',
          sessionId: 'session-1',
          identityType: 'BUSINESS_USER',
          role: 'PRIMARY_OWNER',
          businessIds: ['business-1'],
        },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('activates the pending Primary Owner in the same reviewed transaction', async () => {
    client.query
      .mockResolvedValueOnce({ rows: [businessRow] })
      .mockResolvedValueOnce({
        rows: [
          {
            ...businessRow,
            status: 'ACTIVE',
            activation_at: new Date('2026-08-05T01:00:00.000Z'),
          },
        ],
      })
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'membership-1' }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await expect(
      service.changeStatus(
        'business-1',
        { status: 'ACTIVE', reason: 'Registration approved' },
        {
          userId: 'admin-1',
          sessionId: 'admin-session-1',
          identityType: 'PLATFORM_ADMIN',
          role: 'PLATFORM_SUPER_ADMIN',
          businessIds: [],
        },
      ),
    ).resolves.toMatchObject({ status: 'ACTIVE' });
    expect(client.query).toHaveBeenCalledWith(
      expect.stringContaining("role_code = 'PRIMARY_OWNER'"),
      ['business-1'],
    );
    expect(audit.recordWithClient).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        actionType: 'BUSINESS_STATUS_CHANGED',
        previousValue: { status: 'REGISTRATION' },
        newValue: { status: 'ACTIVE' },
      }),
    );
  });
});
