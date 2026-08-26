const { createHash, randomUUID } = require('node:crypto');
const { performance } = require('node:perf_hooks');
const { Pool } = require('pg');
const {
  DEFAULT_CLAMAV_CONFIG, DEFAULT_DATABASE_POOL_CONFIG,
  DEFAULT_FIREBASE_CONFIG, DEFAULT_VERIFYET_CONFIG,
} = require('../dist/config/app-config');
const { DatabaseService } = require('../dist/database/database.service');
const { CentralDao } = require('../dist/database/central.dao');
const { V2AuditService } = require('../dist/audit/v2-audit.service');
const { S3ObjectStorageService } = require('../dist/storage/s3-object-storage.service');
const { ArchiveCryptoService } = require('../dist/archive/archive-crypto.service');
const { ArchiveDao } = require('../dist/archive/archive.dao');
const { ArchiveWorker } = require('../dist/archive/archive.worker');
const { ArchiveService } = require('../dist/archive/archive.service');

const databaseUrl = process.env.ARCHIVE_EXERCISE_DATABASE_URL;
const evidenceBytes = boundedInteger(
  'ARCHIVE_EXERCISE_BYTES', 16 * 1024 * 1024, 1024, 64 * 1024 * 1024,
);
if (!databaseUrl) throw new Error('ARCHIVE_EXERCISE_DATABASE_URL is required');

const config = {
  environment: 'test', port: 0, logLevel: 'error', databaseSchemaVersion: 'v2',
  databaseUrl, databasePool: DEFAULT_DATABASE_POOL_CONFIG,
  clamav: DEFAULT_CLAMAV_CONFIG, verifyEt: DEFAULT_VERIFYET_CONFIG,
  firebase: DEFAULT_FIREBASE_CONFIG, notificationWorkerPollMs: 2_000,
  redisUrl: 'redis://127.0.0.1:6379',
  jwtAccessSecret: 'archive-exercise-jwt-secret-longer-than-thirty-two-characters',
  accountEncryptionKey:
    'archive-exercise-account-key-longer-than-thirty-two-characters',
  archiveEncryptionKey:
    process.env.ARCHIVE_EXERCISE_ENCRYPTION_KEY ??
      'archive-exercise-isolated-key-longer-than-thirty-two-characters',
  archiveEncryptionKeyId: process.env.ARCHIVE_EXERCISE_ENCRYPTION_KEY_ID ?? 'primary',
  jwtAccessTtlSeconds: 900, refreshTokenTtlSeconds: 3_600,
  passwordResetTtlSeconds: 300,
  s3: {
    endpoint: process.env.ARCHIVE_EXERCISE_S3_ENDPOINT ?? 'http://127.0.0.1:9000',
    region: 'us-east-1', bucket: process.env.ARCHIVE_EXERCISE_S3_BUCKET ?? 'payguard',
    accessKeyId: process.env.ARCHIVE_EXERCISE_S3_ACCESS_KEY_ID ?? '',
    secretAccessKey: process.env.ARCHIVE_EXERCISE_S3_SECRET_ACCESS_KEY ?? '',
    forcePathStyle: true,
  },
};

async function main() {
  validateStorageConfig();
  const pool = new Pool({ connectionString: databaseUrl, max: 2,
    application_name: 'payguard-phase9-archive-exercise' });
  const database = new DatabaseService(config);
  const central = new CentralDao(database);
  const audit = new V2AuditService(database);
  const archives = new ArchiveDao(central, audit);
  const storage = new S3ObjectStorageService(config);
  const crypto = new ArchiveCryptoService(config);
  const worker = new ArchiveWorker(archives, crypto, storage);
  const service = new ArchiveService(archives, crypto, storage);
  let archiveObjectKey;
  let sourceObjectKey;
  try {
    const identity = await pool.query('SELECT current_database() AS name');
    const databaseName = identity.rows[0]?.name;
    if (typeof databaseName !== 'string' || !databaseName.endsWith('_test')) {
      throw new Error('Phase 9 archive exercise requires a database ending in _test');
    }
    if (!await waitForStorage(storage)) {
      throw new Error('Archive object storage did not become ready');
    }
    const fixture = await requireFixture(pool);
    const evidence = Buffer.alloc(evidenceBytes, 0x5a);
    const evidenceHash = sha256(evidence);
    const receiptId = randomUUID();
    sourceObjectKey = `private/phase9-archive-source/${receiptId}.pdf`;
    await storage.putObject(sourceObjectKey, evidence, 'application/pdf');
    await pool.query(
      `INSERT INTO transaction_receipts (
         id, transaction_id, storage_object_key, file_name, mime_type,
         file_size_bytes, file_hash, submitted_by_user_id, created_at
       ) VALUES ($1,$2,$3,'phase9-archive-proof.pdf','application/pdf',$4,$5,$6,$7)`,
      [receiptId, fixture.transaction_id, sourceObjectKey, evidence.byteLength,
       evidenceHash, fixture.submitted_by_user_id,
       new Date('2024-01-01T00:00:00.000Z')],
    );

    const archiveStarted = performance.now();
    const archiveResult = await worker.processNext(
      new Date('2026-08-13T00:00:00.000Z'),
    );
    const archiveMs = performance.now() - archiveStarted;
    if (archiveResult !== 'ARCHIVED') {
      throw new Error(`Expected ARCHIVED, received ${archiveResult}`);
    }
    const archived = await pool.query(
      `SELECT batch.id AS batch_id, batch.storage_object_key,
              record.id AS archive_record_id, receipt.archived_at,
              deletion.deleted_at
       FROM archive_batch_records record
       JOIN archive_batches batch ON batch.id = record.archive_batch_id
       JOIN transaction_receipts receipt ON receipt.id = record.source_record_id
       JOIN archive_source_deletions deletion
         ON deletion.archive_batch_record_id = record.id
       WHERE record.source_record_id = $1`, [receiptId],
    );
    const archiveRow = archived.rows[0];
    if (!archiveRow?.archived_at || archiveRow.deleted_at) {
      throw new Error('Archive state did not preserve the post-verify deletion boundary');
    }
    archiveObjectKey = archiveRow.storage_object_key;

    const deletionResult = await worker.processNext();
    if (deletionResult !== 'SOURCE_DELETED') {
      throw new Error(`Expected SOURCE_DELETED, received ${deletionResult}`);
    }
    await expectMissingObject(storage, sourceObjectKey);

    const retrieveStarted = performance.now();
    const retrieved = await service.retrieve(
      archiveRow.batch_id, receiptId,
      'Phase 9 production-size archive recovery exercise',
      { userId: fixture.platform_admin_id, sessionId: fixture.admin_session_id,
        role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN',
        businessIds: [] },
    );
    const retrieveMs = performance.now() - retrieveStarted;
    if (retrieved.sha256 !== evidenceHash ||
        !Buffer.from(retrieved.body).equals(evidence)) {
      throw new Error('Retrieved archive evidence does not match the source');
    }
    const proof = await pool.query(
      `SELECT
         (SELECT count(*) FROM archive_retrieval_history history
          WHERE history.archive_batch_record_id = $1
            AND history.integrity_verified) AS retrieval_count,
         (SELECT array_agg(action_type ORDER BY action_type) FROM audit_logs
          WHERE record_id IN ($1, $2, $3)
            AND action_type IN ('ARCHIVE_BATCH_VERIFIED',
              'ARCHIVE_SOURCE_DELETED','ARCHIVE_RECORD_RETRIEVED')) AS actions`,
      [archiveRow.archive_record_id, receiptId, archiveRow.batch_id],
    );
    const actions = proof.rows[0]?.actions ?? [];
    if (Number(proof.rows[0]?.retrieval_count) !== 1 || actions.length !== 3) {
      throw new Error('Archive retrieval history or lifecycle audit is incomplete');
    }
    process.stdout.write(`${JSON.stringify({ database: databaseName,
      evidenceBytes, evidenceSha256: evidenceHash,
      archiveMs: Number(archiveMs.toFixed(2)),
      retrieveMs: Number(retrieveMs.toFixed(2)),
      sourceDeleted: true, retrievedIntegrityVerified: true,
      lifecycleAuditActions: actions }, null, 2)}\n`);
  } finally {
    if (sourceObjectKey) {
      await storage.deleteObject(sourceObjectKey).catch(() => undefined);
    }
    if (archiveObjectKey && process.env.ARCHIVE_EXERCISE_PRESERVE_ARCHIVE !== 'true') {
      await storage.deleteObject(archiveObjectKey).catch(() => undefined);
    }
    await database.onApplicationShutdown();
    await pool.end();
  }
}

async function requireFixture(pool) {
  const result = await pool.query(
    `SELECT transaction.id AS transaction_id, transaction.submitted_by_user_id,
            admin.id AS platform_admin_id, session.id AS admin_session_id
     FROM customer_transactions transaction
     CROSS JOIN LATERAL (
       SELECT id FROM platform_admin WHERE status = 'ACTIVE' ORDER BY created_at LIMIT 1
     ) admin
     CROSS JOIN LATERAL (
       SELECT id FROM platform_admin_sessions
       WHERE platform_admin_id = admin.id ORDER BY created_at DESC LIMIT 1
     ) session
     ORDER BY transaction.created_at LIMIT 1`,
  );
  if (!result.rows[0]) {
    throw new Error('Run the V2 integration suite first to create archive fixtures');
  }
  return result.rows[0];
}

async function waitForStorage(storage) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await storage.isReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function expectMissingObject(storage, key) {
  try {
    await storage.getObject(key);
  } catch {
    return;
  }
  throw new Error('Archived source object still exists after confirmed deletion');
}

function validateStorageConfig() {
  if (config.s3.accessKeyId.length < 1 || config.s3.secretAccessKey.length < 16) {
    throw new Error('Archive exercise S3 test credentials are required');
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function boundedInteger(name, fallback, minimum, maximum) {
  const raw = process.env[name];
  const value = raw === undefined ? fallback : Number(raw);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
