import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Pool } from 'pg';

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeWithDatabase = databaseUrl ? describe : describe.skip;

describeWithDatabase('foundation migration', () => {
  const pool = new Pool({ connectionString: databaseUrl });

  beforeAll(async () => {
    const current = await pool.query<{ name: string }>(
      'SELECT current_database() AS name',
    );
    if (!current.rows[0]?.name.endsWith('_test')) {
      throw new Error('Integration migrations require a database ending in _test');
    }
    await pool.query('DROP SCHEMA public CASCADE');
    await pool.query('CREATE SCHEMA public');

    const sql = await readFile(
      join(process.cwd(), 'migrations', '001_foundation.sql'),
      'utf8',
    );
    await pool.query(sql);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('creates the identity, tenancy, session and audit tables', async () => {
    const result = await pool.query<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name = ANY($1::text[])`,
      [
        [
          'users',
          'roles',
          'sessions',
          'devices',
          'businesses',
          'branches',
          'audit_logs',
        ],
      ],
    );
    expect(result.rows).toHaveLength(7);
  });

  it('seeds exactly the five authoritative roles', async () => {
    const result = await pool.query<{ code: string }>(
      'SELECT code FROM roles ORDER BY code',
    );
    expect(result.rows.map((row) => row.code).sort()).toEqual([
      'BUSINESS_OWNER',
      'CASHIER',
      'MANAGER',
      'PLATFORM_SUPER_ADMIN',
      'WAITER',
    ]);
  });
});
