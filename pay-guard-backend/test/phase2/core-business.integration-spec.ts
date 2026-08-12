import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { Pool } from 'pg';
import { AuditService } from '../../src/audit/audit.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { AuthRepository } from '../../src/auth/auth.repository';
import { PasswordService } from '../../src/auth/password.service';
import { BanksService } from '../../src/banks/banks.service';
import { BranchesService } from '../../src/branches/branches.service';
import { BusinessesService } from '../../src/businesses/businesses.service';
import { AccountCryptoService } from '../../src/common/account-crypto.service';
import {
  AppConfig,
  DEFAULT_DATABASE_POOL_CONFIG,
} from '../../src/config/app-config';
import { DatabaseService } from '../../src/database/database.service';
import { UsersService } from '../../src/users/users.service';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

const config = {
  environment: 'test',
  databaseUrl,
  databasePool: DEFAULT_DATABASE_POOL_CONFIG,
  jwtAccessSecret: 'phase-two-jwt-secret-that-is-long-enough',
  accountEncryptionKey: 'phase-two-account-key-that-is-long-enough',
} as AppConfig;

describeWithDatabase('Phase 2 core business setup', () => {
  const pool = new Pool({ connectionString: databaseUrl });
  let database: DatabaseService;
  let users: UsersService;
  let banks: BanksService;
  let businesses: BusinessesService;
  let branches: BranchesService;
  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
  let owner: AuthenticatedPrincipal;
  let otherOwner: AuthenticatedPrincipal;
  let businessId: string;
  let otherBusinessId: string;
  let branchId: string;
  let managerId: string;
  let waiterId: string;
  let bankId: string;

  beforeAll(async () => {
    const current = await pool.query<{ name: string }>(
      'SELECT current_database() AS name',
    );
    if (!current.rows[0]?.name.endsWith('_test')) {
      throw new Error('Phase 2 integration requires a database ending in _test');
    }
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');
    for (const migration of [
      '001_foundation.sql',
      '002_core_business_setup.sql',
    ]) {
      await pool.query(
        await readFile(join(process.cwd(), 'migrations', migration), 'utf8'),
      );
    }

    const seeded = await pool.query<{
      owner_id: string;
      other_owner_id: string;
      business_id: string;
      other_business_id: string;
      branch_id: string;
      manager_id: string;
      waiter_id: string;
      bank_id: string;
    }>(`
      WITH owner_user AS (
        INSERT INTO users (email, password_hash)
        VALUES ('owner-one@example.test', 'hash') RETURNING id
      ), other_owner_user AS (
        INSERT INTO users (email, password_hash)
        VALUES ('owner-two@example.test', 'hash') RETURNING id
      ), manager_user AS (
        INSERT INTO users (email, password_hash)
        VALUES ('manager@example.test', 'hash') RETURNING id
      ), waiter_user AS (
        INSERT INTO users (email, password_hash)
        VALUES ('waiter@example.test', 'hash') RETURNING id
      ), role_rows AS (
        INSERT INTO user_roles (user_id, role_code)
        SELECT id, 'BUSINESS_OWNER'::role_code FROM owner_user
        UNION ALL SELECT id, 'BUSINESS_OWNER'::role_code FROM other_owner_user
        UNION ALL SELECT id, 'MANAGER'::role_code FROM manager_user
        UNION ALL SELECT id, 'WAITER'::role_code FROM waiter_user
      ), business AS (
        INSERT INTO businesses (name, status)
        VALUES ('Tenant One', 'ACTIVE') RETURNING id
      ), other_business AS (
        INSERT INTO businesses (name, status)
        VALUES ('Tenant Two', 'ACTIVE') RETURNING id
      ), owner_links AS (
        INSERT INTO business_owners (business_id, user_id)
        SELECT business.id, owner_user.id FROM business, owner_user
        UNION ALL
        SELECT other_business.id, other_owner_user.id
        FROM other_business, other_owner_user
      ), branch AS (
        INSERT INTO branches (business_id, name)
        SELECT id, 'Main Branch' FROM business RETURNING id
      ), settings AS (
        INSERT INTO branch_settings (branch_id)
        SELECT id FROM branch
      ), assignments AS (
        INSERT INTO branch_user_assignments (branch_id, user_id, role_code)
        SELECT branch.id, manager_user.id, 'MANAGER'::role_code
        FROM branch, manager_user
        UNION ALL
        SELECT branch.id, waiter_user.id, 'WAITER'::role_code
        FROM branch, waiter_user
      ), device AS (
        INSERT INTO devices (user_id, device_identifier_hash, platform)
        SELECT id, 'device-hash', 'android' FROM waiter_user RETURNING id, user_id
      ), session AS (
        INSERT INTO sessions (
          user_id, device_id, refresh_token_hash, expires_at
        )
        SELECT device.user_id, device.id, 'refresh-hash', now() + interval '1 day'
        FROM device
      )
      SELECT
        owner_user.id AS owner_id,
        other_owner_user.id AS other_owner_id,
        business.id AS business_id,
        other_business.id AS other_business_id,
        branch.id AS branch_id,
        manager_user.id AS manager_id,
        waiter_user.id AS waiter_id,
        (SELECT id FROM banks WHERE code = 'CBE') AS bank_id
      FROM owner_user, other_owner_user, business, other_business, branch,
           manager_user, waiter_user
    `);
    const row = seeded.rows[0];
    businessId = row.business_id;
    otherBusinessId = row.other_business_id;
    branchId = row.branch_id;
    managerId = row.manager_id;
    waiterId = row.waiter_id;
    bankId = row.bank_id;
    owner = {
      userId: row.owner_id,
      sessionId: 'owner-session',
      role: 'BUSINESS_OWNER',
      businessIds: [businessId],
    };
    otherOwner = {
      userId: row.other_owner_id,
      sessionId: 'other-session',
      role: 'BUSINESS_OWNER',
      businessIds: [otherBusinessId],
    };

    database = new DatabaseService(config);
    users = new UsersService(database, new PasswordService(), audit);
    businesses = new BusinessesService(
      database,
      {
        hash: jest.fn().mockResolvedValue('registration-password-hash'),
      } as unknown as PasswordService,
      audit,
    );
    branches = new BranchesService(database, audit);
    banks = new BanksService(
      database,
      new AccountCryptoService(config),
      audit,
    );
  });

  afterAll(async () => {
    if (database) await database.onApplicationShutdown();
    await pool.end();
  });

  it('enforces cross-business isolation without disclosing resources', async () => {
    await expect(
      users.list(businessId, branchId, otherOwner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('self-registers a pending business and allows only Super Admin review', async () => {
    const registered = await businesses.register({
      name: 'Pending Tenant',
      registrationNumber: 'REG-PENDING-001',
      ownerEmail: 'pending-owner@example.test',
      password: 'temporary-password',
    });
    expect(registered).toMatchObject({
      name: 'Pending Tenant',
      status: 'PENDING',
    });
    const ownerLink = await pool.query(
      `SELECT 1 FROM business_owners WHERE business_id = $1`,
      [registered.id],
    );
    expect(ownerLink.rowCount).toBe(1);
    await expect(
      businesses.changeStatus(
        registered.id,
        { status: 'ACTIVE' },
        owner,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    const activated = await businesses.changeStatus(
      registered.id,
      { status: 'ACTIVE', reason: 'Application approved' },
      {
        userId: owner.userId,
        sessionId: 'admin-session',
        role: 'PLATFORM_SUPER_ADMIN',
        businessIds: [],
      },
    );
    expect(activated.status).toBe('ACTIVE');
    const history = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM business_status_history
       WHERE business_id = $1`,
      [registered.id],
    );
    expect(Number(history.rows[0].count)).toBe(2);
  });

  it('creates and reads branches only inside the Owner business scope', async () => {
    const created = await branches.create(
      businessId,
      {
        name: 'North Branch',
        timezone: 'Africa/Addis_Ababa',
      },
      owner,
    );
    expect(created).toMatchObject({
      businessId,
      name: 'North Branch',
      settings: { currencyCode: 'ETB' },
    });
    await expect(
      branches.list(businessId, otherOwner),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rejects assigning one operational user to a second active branch', async () => {
    const second = await pool.query<{ id: string }>(
      `INSERT INTO branches (business_id, name)
       VALUES ($1, 'Second Branch') RETURNING id`,
      [businessId],
    );
    await expect(
      pool.query(
        `INSERT INTO branch_user_assignments (branch_id, user_id, role_code)
         VALUES ($1, $2, 'WAITER')`,
        [second.rows[0].id, waiterId],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('derives operational business scope from the active branch assignment', async () => {
    const context = await new AuthRepository(database).getUserContext(managerId);
    expect(context).toMatchObject({
      id: managerId,
      role: 'MANAGER',
      branchId,
      businessIds: [businessId],
    });
  });

  it('soft-removes staff and atomically revokes assignment, session and device', async () => {
    await users.remove(
      businessId,
      branchId,
      waiterId,
      { reason: 'Employment ended' },
      owner,
    );
    const state = await pool.query<{
      status: string;
      assignment_active: boolean;
      revoked: boolean;
      device_active: boolean;
    }>(
      `SELECT u.status,
              bua.active AS assignment_active,
              (s.revoked_at IS NOT NULL) AS revoked,
              d.active AS device_active
       FROM users u
       JOIN branch_user_assignments bua ON bua.user_id = u.id
       JOIN sessions s ON s.user_id = u.id
       JOIN devices d ON d.user_id = u.id
       WHERE u.id = $1`,
      [waiterId],
    );
    expect(state.rows[0]).toEqual({
      status: 'REMOVED',
      assignment_active: false,
      revoked: true,
      device_active: false,
    });
    const history = await users.list(businessId, branchId, owner, true);
    expect(history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: waiterId,
          status: 'REMOVED',
          removalReason: 'Employment ended',
        }),
      ]),
    );
  });

  it('protects the final active Manager from removal', async () => {
    await expect(
      users.remove(
        businessId,
        branchId,
        managerId,
        { reason: 'Attempted final manager removal' },
        owner,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('stores encrypted settlement values, returns masks and enforces uniqueness', async () => {
    const created = await banks.createBranchAccount(
      businessId,
      branchId,
      {
        bankId,
        accountValue: '1000200030004567',
        label: 'Primary CBE',
      },
      owner,
    );
    expect(created).toMatchObject({
      accountMask: '************4567',
      accountSuffix: '30004567',
    });
    expect(JSON.stringify(created)).not.toContain('1000200030004567');

    const stored = await pool.query<{ account_ciphertext: string }>(
      `SELECT account_ciphertext FROM settlement_accounts WHERE id = $1`,
      [created.id],
    );
    expect(stored.rows[0].account_ciphertext).not.toContain(
      '1000200030004567',
    );
    await expect(
      banks.createBranchAccount(
        businessId,
        branchId,
        { bankId, accountValue: '9999888877776666' },
        owner,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
