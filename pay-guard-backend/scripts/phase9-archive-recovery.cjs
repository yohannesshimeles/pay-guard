const { createHash } = require('node:crypto');
const { Pool } = require('pg');
const { DEFAULT_CLAMAV_CONFIG, DEFAULT_DATABASE_POOL_CONFIG,
  DEFAULT_FIREBASE_CONFIG, DEFAULT_VERIFYET_CONFIG } = require('../dist/config/app-config');
const { DatabaseService } = require('../dist/database/database.service');
const { CentralDao } = require('../dist/database/central.dao');
const { V2AuditService } = require('../dist/audit/v2-audit.service');
const { S3ObjectStorageService } = require('../dist/storage/s3-object-storage.service');
const { ArchiveCryptoService } = require('../dist/archive/archive-crypto.service');
const { ArchiveDao } = require('../dist/archive/archive.dao');
const { ArchiveService } = require('../dist/archive/archive.service');

const databaseUrl = process.env.ARCHIVE_RECOVERY_DATABASE_URL;
if (!databaseUrl) throw new Error('ARCHIVE_RECOVERY_DATABASE_URL is required');
const config = {
  environment: 'test', port: 0, logLevel: 'error', databaseSchemaVersion: 'v2',
  databaseUrl, databasePool: DEFAULT_DATABASE_POOL_CONFIG,
  clamav: DEFAULT_CLAMAV_CONFIG, verifyEt: DEFAULT_VERIFYET_CONFIG,
  firebase: DEFAULT_FIREBASE_CONFIG, notificationWorkerPollMs: 2_000,
  redisUrl: 'redis://127.0.0.1:6379',
  jwtAccessSecret: 'archive-recovery-jwt-secret-longer-than-thirty-two-characters',
  accountEncryptionKey: 'archive-recovery-account-key-longer-than-thirty-two-characters',
  archiveEncryptionKey: process.env.ARCHIVE_EXERCISE_ENCRYPTION_KEY ??
    'archive-exercise-isolated-key-longer-than-thirty-two-characters',
  archiveEncryptionKeyId: process.env.ARCHIVE_EXERCISE_ENCRYPTION_KEY_ID ?? 'primary',
  archivePreviousEncryptionKeys: parsePreviousKeys(),
  jwtAccessTtlSeconds: 900, refreshTokenTtlSeconds: 3_600,
  passwordResetTtlSeconds: 300,
  s3: { endpoint: process.env.ARCHIVE_EXERCISE_S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    region: 'us-east-1', bucket: process.env.ARCHIVE_EXERCISE_S3_BUCKET ?? 'payguard',
    accessKeyId: process.env.ARCHIVE_EXERCISE_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.ARCHIVE_EXERCISE_S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: true },
};

async function main() {
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!databaseName.endsWith('_restore_test')) {
    throw new Error('Archive recovery requires a database ending in _restore_test');
  }
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  const database = new DatabaseService(config);
  const storage = new S3ObjectStorageService(config);
  const service = new ArchiveService(
    new ArchiveDao(new CentralDao(database), new V2AuditService(database)),
    new ArchiveCryptoService(config), storage,
  );
  let recoveredObjectKey;
  try {
    const result = await pool.query(
      `SELECT batch.id AS batch_id, record.source_record_id AS record_id,
              batch.storage_object_key,
              admin.id AS admin_id, session.id AS session_id
       FROM archive_batch_records record
       JOIN archive_batches batch ON batch.id = record.archive_batch_id
       CROSS JOIN LATERAL (SELECT id FROM platform_admin WHERE status='ACTIVE'
         ORDER BY created_at LIMIT 1) admin
       CROSS JOIN LATERAL (SELECT id FROM platform_admin_sessions
         WHERE platform_admin_id=admin.id ORDER BY created_at DESC LIMIT 1) session
       WHERE batch.verified_at IS NOT NULL ORDER BY batch.verified_at DESC LIMIT 1`,
    );
    const row = result.rows[0];
    if (!row) throw new Error('Restored database has no verified archive record');
    recoveredObjectKey = row.storage_object_key;
    const recovered = await service.retrieve(row.batch_id, row.record_id,
      'Phase 9 encrypted-backup archive recovery drill',
      { userId: row.admin_id, sessionId: row.session_id,
        role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN', businessIds: [] });
    const hash = createHash('sha256').update(recovered.body).digest('hex');
    if (hash !== recovered.sha256 || recovered.body.byteLength < 1) {
      throw new Error('Recovered archive bytes failed package integrity');
    }
    process.stdout.write(JSON.stringify({ database: databaseName,
      recordId: row.record_id, recoveredBytes: recovered.body.byteLength,
      sha256Verified: true, retrievalAudited: true }, null, 2) + '\n');
  } finally {
    if (recoveredObjectKey && process.env.ARCHIVE_RECOVERY_DELETE_OBJECT === 'true') {
      await storage.deleteObject(recoveredObjectKey).catch(() => undefined);
    }
    await database.onApplicationShutdown();
    await pool.end();
  }
}

function parsePreviousKeys() {
  const raw = process.env.ARCHIVE_EXERCISE_PREVIOUS_ENCRYPTION_KEYS ?? '{}';
  const value = JSON.parse(raw);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('ARCHIVE_EXERCISE_PREVIOUS_ENCRYPTION_KEYS must be an object');
  }
  return value;
}

main().catch((error) => { process.stderr.write(`${error.message ?? error}\n`); process.exitCode = 1; });
