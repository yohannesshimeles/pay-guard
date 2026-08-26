import {
  ForbiddenException, Inject, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';
import { OBJECT_STORAGE, ObjectStoragePort } from '../storage/object-storage.port';
import { ArchiveCryptoService, sha256 } from './archive-crypto.service';
import { ArchiveDao } from './archive.dao';

@Injectable()
export class ArchiveService {
  constructor(
    private readonly archives: ArchiveDao,
    private readonly crypto: ArchiveCryptoService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async list(actor: AuthenticatedPrincipal) {
    this.assertPlatformAdmin(actor);
    const rows = await this.archives.listBatches();
    return rows.map((row) => ({
      id: row.id, jobMonth: row.job_month, sourceType: row.source_type,
      recordCount: row.record_count, sizeBytes: Number(row.file_size_bytes),
      sha256: row.encrypted_sha256, verifiedAt: row.verified_at,
      createdAt: row.created_at,
    }));
  }

  async retrieve(
    batchId: string, recordId: string, reason: string,
    actor: AuthenticatedPrincipal,
  ) {
    this.assertPlatformAdmin(actor);
    const archived = await this.archives.findRecord(batchId, recordId);
    if (!archived) throw new NotFoundException('Archived record was not found');
    try {
      const stored = await this.storage.getObject(archived.storage_object_key);
      const archivePackage = this.crypto.decrypt(stored, {
        encryptedSha256: archived.encrypted_sha256,
        plaintextSha256: archived.plaintext_sha256,
      });
      const record = archivePackage.records.find((item) => item.id === recordId);
      if (!record) throw new Error('Archived record is absent from its batch');
      const body = Buffer.from(record.evidenceBase64, 'base64');
      if (body.byteLength !== record.fileSizeBytes || sha256(body) !== record.fileHash) {
        throw new Error('Archived evidence integrity mismatch');
      }
      await this.archives.recordRetrieval({
        archiveRecordId: archived.archive_record_id, recordId,
        businessId: archived.business_id,
        branchId: archived.branch_id ?? undefined,
        platformAdminId: actor.userId, reason,
        actor: this.adminActor(actor), sessionId: actor.sessionId,
      });
      return { body, fileName: record.fileName, contentType: record.mimeType,
        sha256: record.fileHash };
    } catch (error) {
      if (error instanceof UnprocessableEntityException) throw error;
      throw new UnprocessableEntityException(
        'Archived record failed integrity verification',
      );
    }
  }

  private assertPlatformAdmin(actor: AuthenticatedPrincipal): void {
    if (actor.identityType !== 'PLATFORM_ADMIN' ||
        actor.role !== 'PLATFORM_SUPER_ADMIN') {
      throw new ForbiddenException('Platform Super Admin access required');
    }
  }

  private adminActor(actor: AuthenticatedPrincipal): V2SelectedAuthContext {
    return { identityType: 'PLATFORM_ADMIN', subjectId: actor.userId,
      role: 'PLATFORM_SUPER_ADMIN' };
  }
}
