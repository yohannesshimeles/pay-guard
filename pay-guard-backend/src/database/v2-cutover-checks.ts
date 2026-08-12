import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool } from 'pg';

export type CutoverCheck = {
  name: string;
  status: 'PASS' | 'FAIL' | 'WARN';
  detail: string;
};

const expectedMigrationNames = [
  '001_payguard_v2_initial.sql',
  '002_v2_secure_sessions.sql',
  '003_v2_platform_admin_audit.sql',
];

export function validateCutoverEnvironment(
  environment: NodeJS.ProcessEnv,
): CutoverCheck[] {
  const checks: CutoverCheck[] = [];
  const schemaVersion = environment.DATABASE_SCHEMA_VERSION;
  checks.push({
    name: 'Explicit V2 schema mode',
    status: schemaVersion === 'v2' ? 'PASS' : 'FAIL',
    detail:
      schemaVersion === 'v2'
        ? 'DATABASE_SCHEMA_VERSION is v2'
        : 'Set DATABASE_SCHEMA_VERSION=v2 only for the cutover target',
  });

  const jwt = environment.JWT_ACCESS_SECRET ?? '';
  const accountKey = environment.ACCOUNT_ENCRYPTION_KEY ?? '';
  const placeholders = /(replace|example|generated_value|change-me|password123)/i;
  checks.push(secretCheck('JWT access secret', jwt, placeholders));
  checks.push(secretCheck('Account encryption key', accountKey, placeholders));
  checks.push({
    name: 'Separated cryptographic keys',
    status: jwt.length >= 32 && accountKey.length >= 32 && jwt !== accountKey
      ? 'PASS'
      : 'FAIL',
    detail: 'JWT and account-encryption keys must be distinct',
  });

  const databaseUrl = environment.DATABASE_URL ?? '';
  let parsedDatabaseUrl: URL | undefined;
  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    // Reported below without echoing the credential-bearing value.
  }
  checks.push({
    name: 'PostgreSQL cutover target',
    status:
      parsedDatabaseUrl?.protocol === 'postgresql:' ||
      parsedDatabaseUrl?.protocol === 'postgres:'
        ? 'PASS'
        : 'FAIL',
    detail: parsedDatabaseUrl
      ? `Database target parsed for ${parsedDatabaseUrl.hostname}`
      : 'DATABASE_URL is not a valid PostgreSQL URL',
  });

  if (environment.NODE_ENV === 'production' && parsedDatabaseUrl) {
    const sslMode = parsedDatabaseUrl.searchParams.get('sslmode');
    checks.push({
      name: 'Production database transport security',
      status:
        sslMode === 'require' || sslMode === 'verify-ca' || sslMode === 'verify-full'
          ? 'PASS'
          : 'FAIL',
      detail: 'Production DATABASE_URL must require TLS',
    });
    const s3Endpoint = environment.S3_ENDPOINT ?? '';
    checks.push({
      name: 'Production object-storage transport security',
      status: s3Endpoint.startsWith('https://') ? 'PASS' : 'FAIL',
      detail: 'Production S3_ENDPOINT must use HTTPS',
    });
  } else {
    checks.push({
      name: 'Production-only transport checks',
      status: 'WARN',
      detail: 'TLS enforcement is evaluated as a failure when NODE_ENV=production',
    });
  }

  return checks;
}

export async function runDatabaseCutoverChecks(
  databaseUrl: string,
  workspace = process.cwd(),
): Promise<CutoverCheck[]> {
  const checks: CutoverCheck[] = [];
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 5_000,
    application_name: 'payguard-v2-cutover-preflight',
  });
  try {
    const identity = await pool.query<{
      database_name: string;
      server_version: string;
    }>(
      `SELECT current_database() AS database_name,
              current_setting('server_version') AS server_version`,
    );
    checks.push({
      name: 'Database connectivity',
      status: 'PASS',
      detail: `Connected to ${identity.rows[0].database_name} on PostgreSQL ${identity.rows[0].server_version}`,
    });

    const migrationTable = await pool.query<{ table_name: string | null }>(
      `SELECT to_regclass('public.schema_migrations')::text AS table_name`,
    );
    if (!migrationTable.rows[0].table_name) {
      checks.push({
        name: 'Migration history',
        status: 'FAIL',
        detail: 'schema_migrations is missing; apply V2 through the migration runner',
      });
    } else {
      const expected = await migrationChecks(workspace);
      const applied = await pool.query<{
        version: string;
        migration_name: string | null;
        checksum: string | null;
      }>(
        `SELECT version, migration_name, checksum
         FROM schema_migrations ORDER BY version`,
      );
      const records = new Map(
        applied.rows.flatMap((row) => [
          [row.version, row] as const,
          ...(row.migration_name
            ? ([[row.migration_name, row]] as const)
            : []),
        ]),
      );
      for (const migration of expected) {
        const record = records.get(migration.name);
        checks.push({
          name: `Migration ${migration.name}`,
          status:
            record && record.checksum === migration.checksum ? 'PASS' : 'FAIL',
          detail: !record
            ? 'Not recorded as applied'
            : record.checksum === migration.checksum
              ? 'Applied checksum matches the reviewed file'
              : 'Checksum mismatch or missing checksum',
        });
      }
    }

    const requiredRelations = [
      'platform_admin',
      'businesses',
      'branches',
      'business_user_memberships',
      'membership_role_assignments',
      'user_work_assignments',
      'user_sessions',
      'platform_admin_sessions',
      'audit_logs',
      'supported_banks',
      'settlement_accounts',
      'platform_settlement_accounts',
    ];
    const relations = await pool.query<{ missing: string[] }>(
      `SELECT COALESCE(array_agg(name), ARRAY[]::text[]) AS missing
       FROM unnest($1::text[]) name
       WHERE to_regclass('public.' || name) IS NULL`,
      [requiredRelations],
    );
    checks.push({
      name: 'Required V2 relations',
      status: relations.rows[0].missing.length === 0 ? 'PASS' : 'FAIL',
      detail:
        relations.rows[0].missing.length === 0
          ? 'All required V2 tables exist'
          : `Missing: ${relations.rows[0].missing.join(', ')}`,
    });

    const invalidConstraints = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_constraint constraint_record
       JOIN pg_namespace namespace
         ON namespace.oid = constraint_record.connamespace
       WHERE namespace.nspname = 'public'
         AND constraint_record.convalidated = false`,
    );
    checks.push(countCheck(
      'Validated database constraints',
      invalidConstraints.rows[0].count,
      'All public constraints are validated',
      'Unvalidated public constraints found',
    ));

    const requiredTriggers = [
      'trg_audit_immutable',
      'trg_business_account_global_hash',
      'trg_platform_account_global_hash',
      'trg_settlement_branch_tenant',
      'trg_waiter_single_session',
    ];
    const triggers = await pool.query<{ missing: string[] }>(
      `SELECT COALESCE(array_agg(name), ARRAY[]::text[]) AS missing
       FROM unnest($1::text[]) name
       WHERE NOT EXISTS (
         SELECT 1 FROM pg_trigger trigger_record
         WHERE trigger_record.tgname = name
           AND trigger_record.tgenabled <> 'D'
       )`,
      [requiredTriggers],
    );
    checks.push({
      name: 'Security and integrity triggers',
      status: triggers.rows[0].missing.length === 0 ? 'PASS' : 'FAIL',
      detail:
        triggers.rows[0].missing.length === 0
          ? 'All required triggers are enabled'
          : `Missing or disabled: ${triggers.rows[0].missing.join(', ')}`,
    });

    const unhashedSessions = await pool.query<{ count: string }>(
      `SELECT (
         (SELECT count(*) FROM user_sessions
          WHERE session_status = 'ACTIVE' AND refresh_token_hash IS NULL) +
         (SELECT count(*) FROM platform_admin_sessions
          WHERE session_status = 'ACTIVE' AND refresh_token_hash IS NULL)
       )::text AS count`,
    );
    checks.push(countCheck(
      'Hashed active refresh tokens',
      unhashedSessions.rows[0].count,
      'Every active session has a refresh-token hash',
      'Active sessions without refresh-token hashes found',
    ));

    const forbiddenColumns = await pool.query<{ columns: string[] }>(
      `SELECT COALESCE(array_agg(table_name || '.' || column_name), ARRAY[]::text[])
              AS columns
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name IN (
           'settlement_accounts','platform_settlement_accounts',
           'user_sessions','platform_admin_sessions'
         )
         AND column_name IN (
           'account_number','account_value','refresh_token','plain_refresh_token'
         )`,
    );
    checks.push({
      name: 'No plaintext credential columns',
      status: forbiddenColumns.rows[0].columns.length === 0 ? 'PASS' : 'FAIL',
      detail:
        forbiddenColumns.rows[0].columns.length === 0
          ? 'No forbidden plaintext account/token columns exist'
          : `Forbidden columns: ${forbiddenColumns.rows[0].columns.join(', ')}`,
    });

    const tenantViolations = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM settlement_accounts account
       JOIN branches branch ON branch.id = account.branch_id
       WHERE account.scope_type = 'BRANCH'
         AND branch.business_id <> account.business_id`,
    );
    checks.push(countCheck(
      'Settlement-account tenant integrity',
      tenantViolations.rows[0].count,
      'No cross-business branch accounts found',
      'Cross-business branch accounts found',
    ));
  } catch (error) {
    checks.push({
      name: 'Database preflight execution',
      status: 'FAIL',
      detail: error instanceof Error ? error.message : 'Unknown database error',
    });
  } finally {
    await pool.end();
  }
  return checks;
}

async function migrationChecks(workspace: string) {
  const directory = resolve(workspace, 'database', 'initial');
  const files = await readdir(directory);
  const names = files
    .filter((file) => expectedMigrationNames.includes(file))
    .sort();
  return Promise.all(
    expectedMigrationNames.map(async (name) => {
      if (!names.includes(name)) {
        return { name, checksum: '__missing__' };
      }
      const sql = await readFile(join(directory, name), 'utf8');
      return {
        name,
        checksum: createHash('sha256').update(sql, 'utf8').digest('hex'),
      };
    }),
  );
}

function secretCheck(
  name: string,
  value: string,
  placeholders: RegExp,
): CutoverCheck {
  const valid = value.length >= 32 && !placeholders.test(value);
  return {
    name,
    status: valid ? 'PASS' : 'FAIL',
    detail: valid
      ? 'Configured with non-placeholder material'
      : 'Must be at least 32 characters and not a placeholder',
  };
}

function countCheck(
  name: string,
  count: string,
  passDetail: string,
  failureDetail: string,
): CutoverCheck {
  return {
    name,
    status: Number(count) === 0 ? 'PASS' : 'FAIL',
    detail: Number(count) === 0 ? passDetail : `${failureDetail}: ${count}`,
  };
}
