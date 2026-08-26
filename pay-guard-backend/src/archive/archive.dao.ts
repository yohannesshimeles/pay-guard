import { Injectable } from '@nestjs/common';
import { V2AuditService } from '../audit/v2-audit.service';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { CentralDao } from '../database/central.dao';

export type ArchiveClaim = Readonly<{
  jobId: string; jobMonth: string; claimToken: string; attemptNo: number;
}>;

export type EligibleReceipt = Readonly<{
  id: string; transactionId: string; businessId: string; branchId?: string;
  objectKey: string; fileName: string; mimeType: string; fileSizeBytes: number;
  fileHash: string; submittedByUserId: string; createdAt: Date;
}>;

type JobRow = {
  id: string; job_month: string; claim_token: string; attempt_count: number;
};

@Injectable()
export class ArchiveDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly audit: V2AuditService,
  ) {}

  async ensureCurrentJob(referenceTime: Date): Promise<void> {
    const month = `${referenceTime.toISOString().slice(0, 7)}-01`;
    await this.dao.execute(
      `INSERT INTO archive_jobs (job_month) VALUES ($1::date)
       ON CONFLICT (job_month) DO NOTHING`, [month],
    );
  }

  claimNext(): Promise<ArchiveClaim | undefined> {
    return this.dao.transaction(async (transaction) => {
      const job = await transaction.optional<{ id: string; job_month: string }>(
        `SELECT id, job_month::text FROM archive_jobs
         WHERE attempt_count < 3 AND (
           (status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())) OR
           (status = 'RUNNING' AND claimed_at < now() - interval '10 minutes')
         ) ORDER BY job_month, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!job) return undefined;
      const claimed = await transaction.one<JobRow>(
        `UPDATE archive_jobs SET status = 'RUNNING', claim_token = gen_random_uuid(),
           claimed_at = now(), started_at = COALESCE(started_at, now()),
           attempt_count = attempt_count + 1, updated_at = now()
         WHERE id = $1 RETURNING id, job_month::text, claim_token, attempt_count`,
        [job.id],
      );
      return { jobId: claimed.id, jobMonth: claimed.job_month,
        claimToken: claimed.claim_token, attemptNo: claimed.attempt_count };
    });
  }

  async listEligible(referenceTime: Date, limit = 100): Promise<EligibleReceipt[]> {
    const rows = await this.dao.many<{
      id: string; transaction_id: string; business_id: string; branch_id: string | null;
      storage_object_key: string; file_name: string; mime_type: string;
      file_size_bytes: string; file_hash: string; submitted_by_user_id: string;
      created_at: Date;
    }>(
      `SELECT receipt.id, receipt.transaction_id, transaction.business_id,
              transaction.branch_id, receipt.storage_object_key, receipt.file_name,
              receipt.mime_type, receipt.file_size_bytes::text, receipt.file_hash,
              receipt.submitted_by_user_id, receipt.created_at
       FROM transaction_receipts receipt
       JOIN customer_transactions transaction ON transaction.id = receipt.transaction_id
       WHERE receipt.archived_at IS NULL
         AND receipt.created_at < $1::timestamptz - interval '1 year'
         AND NOT EXISTS (SELECT 1 FROM archive_batch_records archived
                         WHERE archived.source_type = 'TRANSACTION_RECEIPT'
                           AND archived.source_record_id = receipt.id)
       ORDER BY receipt.created_at, receipt.id LIMIT $2`,
      [referenceTime, limit],
    );
    return rows.map((row) => ({
      id: row.id, transactionId: row.transaction_id,
      businessId: row.business_id, branchId: row.branch_id ?? undefined,
      objectKey: row.storage_object_key, fileName: row.file_name,
      mimeType: row.mime_type, fileSizeBytes: Number(row.file_size_bytes),
      fileHash: row.file_hash, submittedByUserId: row.submitted_by_user_id,
      createdAt: row.created_at,
    }));
  }

  completeBatch(claim: ArchiveClaim, input: {
    objectKey: string; sizeBytes: number; encryptedSha256: string;
    plaintextSha256: string; manifest: Record<string, unknown>;
    records: EligibleReceipt[]; verifiedAt: Date;
  }): Promise<string> {
    return this.dao.transaction(async (transaction) => {
      const batch = await transaction.one<{ id: string }>(
        `INSERT INTO archive_batches (
           archive_job_id, source_type, storage_object_key, file_size_bytes,
           encrypted_sha256, plaintext_sha256, encryption_algorithm,
           manifest_json, record_count, verified_at
         ) SELECT $1,'TRANSACTION_RECEIPT',$3,$4,$5,$6,'AES-256-GCM',$7::jsonb,$8,$9
           FROM archive_jobs WHERE id = $1 AND claim_token = $2 AND status = 'RUNNING'
         RETURNING id`,
        [claim.jobId, claim.claimToken, input.objectKey, input.sizeBytes,
         input.encryptedSha256, input.plaintextSha256, JSON.stringify(input.manifest),
         input.records.length, input.verifiedAt],
      );
      for (const record of input.records) {
        const archived = await transaction.one<{ id: string }>(
          `INSERT INTO archive_batch_records (
             archive_batch_id, source_type, source_record_id, business_id,
             branch_id, source_created_at
           ) VALUES ($1,'TRANSACTION_RECEIPT',$2,$3,$4,$5) RETURNING id`,
          [batch.id, record.id, record.businessId, record.branchId ?? null,
           record.createdAt],
        );
        await transaction.execute(
          `UPDATE transaction_receipts SET archived_at = now()
           WHERE id = $1 AND archived_at IS NULL`, [record.id],
        );
        await transaction.execute(
          `INSERT INTO archive_source_deletions (
             archive_batch_record_id, storage_object_key
           ) VALUES ($1,$2)`, [archived.id, record.objectKey],
        );
      }
      await transaction.execute(
        `UPDATE archive_jobs SET status = 'QUEUED', records_moved = records_moved + $3,
           claim_token = NULL, claimed_at = NULL, attempt_count = 0,
           next_attempt_at = NULL, failure_reason = NULL, updated_at = now()
         WHERE id = $1 AND claim_token = $2`,
        [claim.jobId, claim.claimToken, input.records.length],
      );
      await this.audit.recordSystemWithin(transaction, {
        actionType: 'ARCHIVE_BATCH_VERIFIED', recordType: 'ARCHIVE_BATCH',
        recordId: batch.id, newValue: { sourceType: 'TRANSACTION_RECEIPT',
          recordCount: input.records.length, encryptedSha256: input.encryptedSha256 },
      });
      return batch.id;
    });
  }

  completeJob(claim: ArchiveClaim): Promise<number> {
    return this.dao.execute(
      `UPDATE archive_jobs SET status = 'COMPLETED', completed_at = now(),
         claim_token = NULL, claimed_at = NULL, attempt_count = 0,
         next_attempt_at = NULL, failure_reason = NULL, updated_at = now()
       WHERE id = $1 AND claim_token = $2`, [claim.jobId, claim.claimToken],
    );
  }

  fail(claim: ArchiveClaim): Promise<number> {
    const final = claim.attemptNo >= 3;
    return this.dao.transaction(async (transaction) => {
      const changed = await transaction.execute(
        `UPDATE archive_jobs SET status = $3, failure_reason = 'ARCHIVE_BATCH_FAILED',
           claim_token = NULL, claimed_at = NULL,
           next_attempt_at = CASE WHEN $3 = 'QUEUED'
             THEN now() + interval '5 minutes' * $4 ELSE NULL END,
           completed_at = CASE WHEN $3 = 'FAILED' THEN now() ELSE NULL END,
           updated_at = now() WHERE id = $1 AND claim_token = $2`,
        [claim.jobId, claim.claimToken, final ? 'FAILED' : 'QUEUED',
         claim.attemptNo],
      );
      if (changed) await this.audit.recordSystemWithin(transaction, {
        actionType: 'ARCHIVE_BATCH_FAILED', recordType: 'ARCHIVE_JOB',
        recordId: claim.jobId, result: 'FAILURE',
        failureReason: 'ARCHIVE_BATCH_FAILED',
        newValue: { attemptNo: claim.attemptNo, final },
      });
      return changed;
    });
  }

  claimSourceDeletion() {
    return this.dao.transaction(async (transaction) => {
      const row = await transaction.optional<{
        id: string; storage_object_key: string; archive_batch_record_id: string;
        source_record_id: string; business_id: string; branch_id: string | null;
      }>(
        `SELECT deletion.id, deletion.storage_object_key,
                deletion.archive_batch_record_id, record.source_record_id,
                record.business_id, record.branch_id
         FROM archive_source_deletions deletion
         JOIN archive_batch_records record ON record.id = deletion.archive_batch_record_id
         WHERE deletion.deleted_at IS NULL AND deletion.attempt_count < 10
           AND deletion.next_attempt_at <= now()
         ORDER BY deletion.next_attempt_at, deletion.id
         FOR UPDATE OF deletion SKIP LOCKED LIMIT 1`,
      );
      if (!row) return undefined;
      await transaction.execute(
        `UPDATE archive_source_deletions SET attempt_count = attempt_count + 1,
           next_attempt_at = now() + interval '5 minutes', updated_at = now()
         WHERE id = $1`, [row.id],
      );
      return { id: row.id, objectKey: row.storage_object_key,
        archiveRecordId: row.archive_batch_record_id,
        sourceRecordId: row.source_record_id, businessId: row.business_id,
        branchId: row.branch_id ?? undefined };
    });
  }

  markSourceDeleted(input: {
    id: string; sourceRecordId: string; businessId: string; branchId?: string;
  }): Promise<number> {
    return this.dao.transaction(async (transaction) => {
      const changed = await transaction.execute(
        `UPDATE archive_source_deletions SET deleted_at = now(),
           last_failure_code = NULL, updated_at = now() WHERE id = $1`, [input.id],
      );
      if (changed) await this.audit.recordSystemWithin(transaction, {
        actionType: 'ARCHIVE_SOURCE_DELETED',
        recordType: 'TRANSACTION_RECEIPT', recordId: input.sourceRecordId,
        businessId: input.businessId, branchId: input.branchId,
        newValue: { protectedArchiveVerified: true },
      });
      return changed;
    });
  }

  markSourceDeleteFailed(input: {
    id: string; sourceRecordId: string; businessId: string; branchId?: string;
  }): Promise<number> {
    return this.dao.transaction(async (transaction) => {
      const changed = await transaction.execute(
        `UPDATE archive_source_deletions
         SET last_failure_code = 'SOURCE_DELETE_FAILED', updated_at = now()
         WHERE id = $1`, [input.id],
      );
      if (changed) await this.audit.recordSystemWithin(transaction, {
        actionType: 'ARCHIVE_SOURCE_DELETE_FAILED',
        recordType: 'TRANSACTION_RECEIPT', recordId: input.sourceRecordId,
        businessId: input.businessId, branchId: input.branchId,
        result: 'FAILURE', failureReason: 'SOURCE_DELETE_FAILED',
      });
      return changed;
    });
  }

  listBatches(limit = 50, offset = 0) {
    return this.dao.many<{
      id: string; job_month: string; source_type: string; record_count: number;
      file_size_bytes: string; encrypted_sha256: string; verified_at: Date;
      created_at: Date;
    }>(
      `SELECT batch.id, job.job_month::text, batch.source_type,
              batch.record_count, batch.file_size_bytes::text,
              batch.encrypted_sha256, batch.verified_at, batch.created_at
       FROM archive_batches batch JOIN archive_jobs job ON job.id = batch.archive_job_id
       ORDER BY batch.created_at DESC, batch.id DESC LIMIT $1 OFFSET $2`,
      [limit, offset],
    );
  }

  findRecord(batchId: string, recordId: string) {
    return this.dao.optional<{
      archive_record_id: string; source_record_id: string; business_id: string;
      branch_id: string | null; source_created_at: Date; storage_object_key: string;
      encrypted_sha256: string; plaintext_sha256: string;
    }>(
      `SELECT record.id AS archive_record_id, record.source_record_id,
              record.business_id, record.branch_id, record.source_created_at,
              batch.storage_object_key, batch.encrypted_sha256, batch.plaintext_sha256
       FROM archive_batch_records record
       JOIN archive_batches batch ON batch.id = record.archive_batch_id
       WHERE batch.id = $1 AND record.source_record_id = $2
         AND record.source_type = 'TRANSACTION_RECEIPT'`, [batchId, recordId],
    );
  }

  recordRetrieval(input: {
    archiveRecordId: string; recordId: string; businessId: string;
    branchId?: string; platformAdminId: string; reason: string;
    actor: V2SelectedAuthContext; sessionId: string;
  }): Promise<void> {
    return this.dao.transaction(async (transaction) => {
      await transaction.execute(
        `INSERT INTO archive_retrieval_history (
           archive_batch_record_id, retrieved_by_admin_id, reason, integrity_verified
         ) VALUES ($1,$2,$3,true)`,
        [input.archiveRecordId, input.platformAdminId, input.reason.trim()],
      );
      await this.audit.recordWithin(transaction, {
        actor: input.actor, sessionId: input.sessionId,
        actionType: 'ARCHIVE_RECORD_RETRIEVED',
        recordType: 'TRANSACTION_RECEIPT', recordId: input.recordId,
        businessId: input.businessId, branchId: input.branchId,
        newValue: { integrityVerified: true }, reason: input.reason,
      });
    });
  }
}
