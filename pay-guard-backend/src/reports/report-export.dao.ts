import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { ReportExportType } from './dto/report-export.dto';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { V2AuditService } from '../audit/v2-audit.service';

type ExportJobRow = {
  id: string; business_id: string; branch_id: string | null;
  report_type: ReportExportType; requested_by_user_id: string;
  idempotency_key: string; filter_json: Record<string, string>;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED' | 'EXPIRED';
  failure_reason: string | null; attempt_count: number;
  claim_token: string | null; created_at: Date; completed_at: Date | null;
};

type ExportFileRow = {
  id: string; job_id: string; storage_object_key: string; file_name: string;
  file_size_bytes: string; content_type: string; sha256: string;
  available_until: Date;
};

export type ReportExportClaim = Readonly<{
  jobId: string; businessId: string; branchId?: string;
  requestedByUserId: string; reportType: ReportExportType;
  dateFrom: string; dateTo: string; settlementAccountId?: string;
  claimToken: string; attemptNo: number;
}>;

@Injectable()
export class ReportExportDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly audit: V2AuditService,
  ) {}

  async create(input: {
    businessId: string; branchId?: string; requestedByUserId: string;
    requestedRole: string; idempotencyKey: string; reportType: ReportExportType;
    dateFrom: string; dateTo: string; settlementAccountId?: string;
    actor: V2SelectedAuthContext; sessionId: string;
  }) {
    return this.dao.transaction(async (transaction) => {
      const inserted = await transaction.optional<ExportJobRow>(
        `INSERT INTO report_generation_jobs (
         business_id, branch_id, report_type, requested_by_user_id,
         request_context_json, filter_json, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7)
       ON CONFLICT (requested_by_user_id, idempotency_key)
         WHERE idempotency_key IS NOT NULL
       DO NOTHING
       RETURNING id, business_id, branch_id, report_type, requested_by_user_id,
         idempotency_key, filter_json, status, failure_reason, attempt_count,
         claim_token, created_at, completed_at`,
        [input.businessId, input.branchId ?? null, input.reportType,
         input.requestedByUserId, JSON.stringify({ role: input.requestedRole }),
         JSON.stringify({
           dateFrom: input.dateFrom, dateTo: input.dateTo,
           ...(input.settlementAccountId
             ? { settlementAccountId: input.settlementAccountId } : {}),
         }), input.idempotencyKey],
      );
      if (inserted) {
        await this.audit.recordWithin(transaction, {
          actor: input.actor,
          sessionId: input.sessionId,
          actionType: 'REPORT_EXPORT_REQUESTED',
          recordType: 'REPORT_GENERATION_JOB',
          recordId: inserted.id,
          businessId: input.businessId,
          branchId: input.branchId,
          newValue: {
            reportType: input.reportType,
            dateFrom: input.dateFrom,
            dateTo: input.dateTo,
            settlementAccountId: input.settlementAccountId,
          },
        });
        return this.mapJob(inserted);
      }
      const existing = await transaction.one<ExportJobRow>(
        `SELECT id, business_id, branch_id, report_type, requested_by_user_id,
                idempotency_key, filter_json, status, failure_reason, attempt_count,
                claim_token, created_at, completed_at
         FROM report_generation_jobs
         WHERE requested_by_user_id = $1 AND idempotency_key = $2`,
        [input.requestedByUserId, input.idempotencyKey],
      );
      return this.mapJob(existing);
    });
  }

  async findOwned(jobId: string, businessId: string, userId: string) {
    const row = await this.dao.optional<ExportJobRow>(
      `SELECT id, business_id, branch_id, report_type, requested_by_user_id,
              idempotency_key, filter_json, status, failure_reason, attempt_count,
              claim_token, created_at, completed_at
       FROM report_generation_jobs
       WHERE id = $1 AND business_id = $2 AND requested_by_user_id = $3`,
      [jobId, businessId, userId],
    );
    return row ? this.mapJob(row) : undefined;
  }

  claimNext(): Promise<ReportExportClaim | undefined> {
    return this.dao.transaction(async (transaction) => {
      const candidate = await transaction.optional<ExportJobRow>(
        `SELECT id, business_id, branch_id, report_type, requested_by_user_id,
                idempotency_key, filter_json, status, failure_reason, attempt_count,
                claim_token, created_at, completed_at
         FROM report_generation_jobs
         WHERE attempt_count < 3 AND (
           (status = 'QUEUED' AND (next_attempt_at IS NULL OR next_attempt_at <= now())) OR
           (status = 'PROCESSING' AND claimed_at < now() - interval '5 minutes')
         )
         ORDER BY created_at, id
         FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!candidate) return undefined;
      const claimed = await transaction.one<{
        claim_token: string; attempt_count: number;
      }>(
        `UPDATE report_generation_jobs
         SET status = 'PROCESSING', claim_token = gen_random_uuid(),
             claimed_at = now(), attempt_count = attempt_count + 1,
             updated_at = now()
         WHERE id = $1 RETURNING claim_token, attempt_count`,
        [candidate.id],
      );
      return {
        jobId: candidate.id, businessId: candidate.business_id,
        branchId: candidate.branch_id ?? undefined,
        requestedByUserId: candidate.requested_by_user_id,
        reportType: candidate.report_type,
        dateFrom: candidate.filter_json.dateFrom,
        dateTo: candidate.filter_json.dateTo,
        settlementAccountId: candidate.filter_json.settlementAccountId,
        claimToken: claimed.claim_token, attemptNo: claimed.attempt_count,
      };
    });
  }

  complete(claim: ReportExportClaim, file: {
    objectKey: string; fileName: string; sizeBytes: number;
    contentType: string; sha256: string;
  }) {
    return this.dao.transaction(async (transaction) => {
      await transaction.one<{ id: string }>(
        `INSERT INTO report_files (
           job_id, storage_object_key, file_name, file_size_bytes,
           content_type, sha256
         ) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [claim.jobId, file.objectKey, file.fileName, file.sizeBytes,
         file.contentType, file.sha256],
      );
      await transaction.execute(
        `UPDATE report_generation_jobs
         SET status = 'READY', completed_at = now(), claim_token = NULL,
             claimed_at = NULL, failure_reason = NULL, updated_at = now()
         WHERE id = $1 AND claim_token = $2`,
        [claim.jobId, claim.claimToken],
      );
    });
  }

  fail(claim: ReportExportClaim, errorCode: string) {
    const final = claim.attemptNo >= 3;
    return this.dao.execute(
      `UPDATE report_generation_jobs
       SET status = $3, failure_reason = $4, claim_token = NULL,
           claimed_at = NULL,
           next_attempt_at = CASE WHEN $3 = 'QUEUED'
             THEN now() + interval '1 minute' * $5 ELSE NULL END,
           completed_at = CASE WHEN $3 = 'FAILED' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $1 AND claim_token = $2`,
      [claim.jobId, claim.claimToken, final ? 'FAILED' : 'QUEUED',
       errorCode, claim.attemptNo],
    );
  }

  async findDownloadOwned(jobId: string, businessId: string, userId: string) {
    const row = await this.dao.optional<ExportFileRow>(
      `SELECT file.id, file.job_id, file.storage_object_key, file.file_name,
              file.file_size_bytes::text, file.content_type, file.sha256,
              file.available_until
       FROM report_files file
       JOIN report_generation_jobs job ON job.id = file.job_id
       WHERE job.id = $1 AND job.business_id = $2
         AND job.requested_by_user_id = $3 AND job.status = 'READY'
         AND file.deleted_at IS NULL AND file.available_until > now()`,
      [jobId, businessId, userId],
    );
    return row ? {
      id: row.id, jobId: row.job_id, objectKey: row.storage_object_key,
      fileName: row.file_name, sizeBytes: Number(row.file_size_bytes),
      contentType: row.content_type, sha256: row.sha256,
      availableUntil: row.available_until,
    } : undefined;
  }

  recordDownload(input: {
    fileId: string; jobId: string; userId: string; businessId: string;
    branchId?: string; actor: V2SelectedAuthContext; sessionId: string;
  }) {
    return this.dao.transaction(async (transaction) => {
      await transaction.execute(
        `INSERT INTO report_download_history (report_file_id, downloaded_by_user_id)
         VALUES ($1,$2)`,
        [input.fileId, input.userId],
      );
      await this.audit.recordWithin(transaction, {
        actor: input.actor,
        sessionId: input.sessionId,
        actionType: 'REPORT_EXPORT_DOWNLOADED',
        recordType: 'REPORT_GENERATION_JOB',
        recordId: input.jobId,
        businessId: input.businessId,
        branchId: input.branchId,
        newValue: { reportFileId: input.fileId },
      });
    });
  }

  claimExpired(): Promise<{ objectKey: string } | undefined> {
    return this.dao.transaction(async (transaction) => {
      const file = await transaction.optional<{
        id: string; job_id: string; storage_object_key: string;
      }>(
        `SELECT id, job_id, storage_object_key FROM report_files
         WHERE deleted_at IS NULL AND available_until <= now()
         ORDER BY available_until, id FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!file) return undefined;
      await transaction.execute(
        `UPDATE report_files SET deleted_at = now() WHERE id = $1`, [file.id],
      );
      await transaction.execute(
        `UPDATE report_generation_jobs SET status = 'EXPIRED', updated_at = now()
         WHERE id = $1 AND status = 'READY'`, [file.job_id],
      );
      return { objectKey: file.storage_object_key };
    });
  }

  private mapJob(row: ExportJobRow) {
    return {
      id: row.id, businessId: row.business_id,
      branchId: row.branch_id ?? undefined, reportType: row.report_type,
      requestedByUserId: row.requested_by_user_id,
      idempotencyKey: row.idempotency_key, dateFrom: row.filter_json.dateFrom,
      dateTo: row.filter_json.dateTo,
      settlementAccountId: row.filter_json.settlementAccountId,
      status: row.status, errorCode: row.failure_reason ?? undefined,
      attemptCount: row.attempt_count, createdAt: row.created_at,
      completedAt: row.completed_at ?? undefined,
    };
  }
}
