import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { OBJECT_STORAGE, ObjectStoragePort } from '../storage/object-storage.port';
import {
  ArchiveCryptoService, ReceiptArchivePackage, sha256,
} from './archive-crypto.service';
import { ArchiveDao, EligibleReceipt } from './archive.dao';

@Injectable()
export class ArchiveWorker {
  private readonly logger = new Logger(ArchiveWorker.name);

  constructor(
    private readonly archives: ArchiveDao,
    private readonly crypto: ArchiveCryptoService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
  ) {}

  async processNext(referenceTime = new Date()): Promise<
    'SOURCE_DELETED' | 'ARCHIVED' | 'COMPLETED' | 'DEFERRED' | 'FAILED' | 'IDLE'
  > {
    const deletion = await this.archives.claimSourceDeletion();
    if (deletion) {
      try {
        await this.storage.deleteObject(deletion.objectKey);
        await this.archives.markSourceDeleted(deletion);
        return 'SOURCE_DELETED';
      } catch {
        await this.archives.markSourceDeleteFailed(deletion);
        return 'DEFERRED';
      }
    }

    await this.archives.ensureCurrentJob(referenceTime);
    const claim = await this.archives.claimNext();
    if (!claim) return 'IDLE';
    let objectKey: string | undefined;
    try {
      const records = await this.archives.listEligible(referenceTime, 100);
      if (!records.length) {
        await this.archives.completeJob(claim);
        return 'COMPLETED';
      }
      const archivePackage = await this.package(records, referenceTime);
      const encrypted = this.crypto.encrypt(archivePackage);
      objectKey = `private/archive/receipts/${claim.jobMonth}/${randomUUID()}.pga`;
      await this.storage.putObject(
        objectKey, encrypted.body, 'application/vnd.payguard.archive+json',
      );
      const stored = await this.storage.getObject(objectKey);
      const verified = this.crypto.decrypt(stored, encrypted);
      this.assertPackageIntegrity(verified, records);
      const manifest = {
        format: verified.format, createdAt: verified.createdAt,
        sourceType: 'TRANSACTION_RECEIPT', recordCount: records.length,
        records: records.map((record) => ({
          id: record.id, transactionId: record.transactionId,
          businessId: record.businessId, branchId: record.branchId,
          createdAt: record.createdAt.toISOString(), mimeType: record.mimeType,
          sizeBytes: record.fileSizeBytes, sha256: record.fileHash,
        })),
      };
      await this.archives.completeBatch(claim, {
        objectKey, sizeBytes: stored.byteLength,
        encryptedSha256: encrypted.encryptedSha256,
        plaintextSha256: encrypted.plaintextSha256,
        manifest, records, verifiedAt: new Date(),
      });
      return 'ARCHIVED';
    } catch {
      if (objectKey) {
        await this.storage.deleteObject(objectKey).catch(() =>
          this.logger.warn(JSON.stringify({ event: 'archive.compensation_failed' })),
        );
      }
      await this.archives.fail(claim);
      return claim.attemptNo >= 3 ? 'FAILED' : 'DEFERRED';
    }
  }

  private async package(
    records: EligibleReceipt[], referenceTime: Date,
  ): Promise<ReceiptArchivePackage> {
    return {
      format: 'PAYGUARD_RECEIPT_ARCHIVE_V1',
      createdAt: referenceTime.toISOString(),
      records: await Promise.all(records.map(async (record) => {
        const evidence = await this.storage.getObject(record.objectKey);
        if (evidence.byteLength !== record.fileSizeBytes ||
            sha256(evidence) !== record.fileHash) {
          throw new Error('Source evidence integrity mismatch');
        }
        return {
          id: record.id, transactionId: record.transactionId,
          businessId: record.businessId, branchId: record.branchId,
          fileName: record.fileName, mimeType: record.mimeType,
          fileSizeBytes: record.fileSizeBytes, fileHash: record.fileHash,
          submittedByUserId: record.submittedByUserId,
          createdAt: record.createdAt.toISOString(),
          evidenceBase64: Buffer.from(evidence).toString('base64'),
        };
      })),
    };
  }

  private assertPackageIntegrity(
    value: ReceiptArchivePackage, records: EligibleReceipt[],
  ): void {
    if (value.records.length !== records.length) {
      throw new Error('Archive record count mismatch');
    }
    const expected = new Map(records.map((record) => [record.id, record]));
    for (const archived of value.records) {
      const source = expected.get(archived.id);
      const evidence = Buffer.from(archived.evidenceBase64, 'base64');
      if (!source || archived.transactionId !== source.transactionId ||
          evidence.byteLength !== source.fileSizeBytes ||
          sha256(evidence) !== source.fileHash) {
        throw new Error('Archive record integrity mismatch');
      }
    }
  }
}
