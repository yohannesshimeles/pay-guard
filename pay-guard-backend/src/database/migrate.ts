import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Pool, PoolClient } from 'pg';
import { loadConfig } from '../config/app-config';

type Command = 'up' | 'down' | 'status';

type MigrationFile = {
  version: string;
  file: string;
  path: string;
  checksum: string;
  sql: string;
};

const migrationPattern = /^(\d{3,})_([a-z0-9_]+)\.sql$/;
const lockKey = 1_884_725_119;

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function command(): Command {
  const value = (argument('--command') ?? 'up').toLowerCase();
  if (value === 'up' || value === 'down' || value === 'status') return value;
  throw new Error(`Unsupported migration command: ${value}`);
}

function migrationDirectory(): string {
  const requested = argument('--dir') ?? 'migrations';
  const directory = resolve(process.cwd(), requested);
  const workspace = resolve(process.cwd());
  if (directory !== workspace && !directory.startsWith(`${workspace}\\`)) {
    throw new Error('Migration directory must remain inside the project workspace');
  }
  return directory;
}

function checksum(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function stripTransactionWrapper(sql: string): string {
  return sql
    .replace(/^\s*BEGIN\s*;\s*/i, '')
    .replace(/\s*COMMIT\s*;\s*$/i, '')
    .trim();
}

async function migrationFiles(directory: string): Promise<MigrationFile[]> {
  const entries = await readdir(directory);
  const files = entries.filter((file) => migrationPattern.test(file)).sort();
  if (!files.length) throw new Error(`No migrations found in ${directory}`);

  const versions = new Set<string>();
  const migrations: MigrationFile[] = [];
  for (const file of files) {
    const match = migrationPattern.exec(file);
    if (!match) continue;
    const version = match[1];
    if (versions.has(version)) throw new Error(`Duplicate migration version ${version}`);
    versions.add(version);
    const path = join(directory, file);
    const raw = await readFile(path, 'utf8');
    migrations.push({
      version,
      file,
      path,
      checksum: checksum(raw),
      sql: stripTransactionWrapper(raw),
    });
  }
  return migrations;
}

async function prepare(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      migration_name text,
      checksum char(64),
      execution_ms integer,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS migration_name text');
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum char(64)');
  await client.query('ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS execution_ms integer');
}

async function appliedMigrations(client: PoolClient) {
  const result = await client.query<{
    version: string;
    migration_name: string | null;
    checksum: string | null;
    applied_at: Date;
  }>(`SELECT version, migration_name, checksum, applied_at
      FROM schema_migrations ORDER BY version`);
  return new Map(result.rows.map((row) => [row.version, row]));
}

async function verifyApplied(
  client: PoolClient,
  files: MigrationFile[],
  applied: Awaited<ReturnType<typeof appliedMigrations>>,
): Promise<void> {
  for (const migration of files) {
    const record = applied.get(migration.file) ?? applied.get(migration.version);
    if (!record) continue;
    if (record.checksum && record.checksum !== migration.checksum) {
      throw new Error(
        `Checksum mismatch for ${migration.file}. Never edit an applied migration; create a new one.`,
      );
    }
    if (!record.checksum) {
      await client.query(
        `UPDATE schema_migrations
         SET checksum = $2, migration_name = COALESCE(migration_name, $3)
         WHERE version = $1`,
        [record.version, migration.checksum, migration.file],
      );
    }
  }
}

async function up(client: PoolClient, files: MigrationFile[]): Promise<void> {
  let applied = await appliedMigrations(client);
  await verifyApplied(client, files, applied);
  applied = await appliedMigrations(client);

  for (const migration of files) {
    if (applied.has(migration.file) || applied.has(migration.version)) continue;
    const started = Date.now();
    await client.query('BEGIN');
    try {
      await client.query(migration.sql);
      await client.query(
        `INSERT INTO schema_migrations(version, migration_name, checksum, execution_ms)
         VALUES ($1, $1, $2, $3)`,
        [migration.file, migration.checksum, Date.now() - started],
      );
      await client.query('COMMIT');
      process.stdout.write(`Applied ${migration.file}\n`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
}

async function down(client: PoolClient, files: MigrationFile[], directory: string) {
  const applied = await appliedMigrations(client);
  await verifyApplied(client, files, applied);
  const latest = [...files]
    .reverse()
    .find((migration) => applied.has(migration.file) || applied.has(migration.version));
  if (!latest) throw new Error('No applied migration is available to roll back');

  const downFile = latest.file.replace(/\.sql$/, '.down.sql');
  let downSql: string;
  try {
    downSql = stripTransactionWrapper(await readFile(join(directory, downFile), 'utf8'));
  } catch {
    throw new Error(
      `Rollback refused: ${downFile} does not exist. Write and review an explicit down migration.`,
    );
  }
  const executableDownSql = downSql
    .replace(/--.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .trim();
  if (!executableDownSql) {
    throw new Error(`Rollback refused: ${downFile} contains no executable SQL.`);
  }

  await client.query('BEGIN');
  try {
    await client.query(downSql);
    await client.query('DELETE FROM schema_migrations WHERE version IN ($1, $2)', [
      latest.file,
      latest.version,
    ]);
    await client.query('COMMIT');
    process.stdout.write(`Rolled back ${latest.file}\n`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function status(client: PoolClient, files: MigrationFile[]): Promise<void> {
  const applied = await appliedMigrations(client);
  await verifyApplied(client, files, applied);
  for (const migration of files) {
    const record = applied.get(migration.file) ?? applied.get(migration.version);
    process.stdout.write(
      `${record ? 'applied' : 'pending'}  ${migration.file}${
        record ? `  ${record.applied_at.toISOString()}` : ''
      }\n`,
    );
  }
}

async function migrate(): Promise<void> {
  const config = loadConfig();
  const pool = new Pool({ connectionString: config.databaseUrl, max: 1 });
  const directory = migrationDirectory();
  const files = await migrationFiles(directory);
  const client = await pool.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [lockKey]);
    await prepare(client);
    const selected = command();
    if (selected === 'up') await up(client, files);
    if (selected === 'down') await down(client, files, directory);
    if (selected === 'status') await status(client, files);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

void migrate().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error';
  process.stderr.write(`Migration failed: ${message}\n`);
  process.exitCode = 1;
});
