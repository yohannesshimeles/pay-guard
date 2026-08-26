import { ForbiddenException, UnprocessableEntityException } from '@nestjs/common';
import { ArchiveCryptoService, sha256 } from '../../src/archive/archive-crypto.service';
import { ArchiveDao } from '../../src/archive/archive.dao';
import { ArchiveService } from '../../src/archive/archive.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';

describe('ArchiveService', () => {
  const findRecord = jest.fn();
  const recordRetrieval = jest.fn();
  const archives = { listBatches: jest.fn(), findRecord,
    recordRetrieval } as unknown as jest.Mocked<ArchiveDao>;
  const crypto = new ArchiveCryptoService({
    archiveEncryptionKey: 'archive-secret-that-is-longer-than-thirty-two-characters',
  } as never);
  const storage = { getObject: jest.fn() } as unknown as jest.Mocked<ObjectStoragePort>;
  const service = new ArchiveService(archives, crypto, storage);
  const admin: AuthenticatedPrincipal = { userId: 'admin-1', sessionId: 'session-1',
    role: 'PLATFORM_SUPER_ADMIN', identityType: 'PLATFORM_ADMIN', businessIds: [] };

  beforeEach(() => jest.clearAllMocks());

  it('rejects business identities even when they forge the platform role', async () => {
    await expect(service.list({ ...admin, identityType: 'BUSINESS_USER' }))
      .rejects.toBeInstanceOf(ForbiddenException);
  });

  it('verifies and audits an authorized record retrieval', async () => {
    const evidence = Buffer.from('proof');
    const encrypted = crypto.encrypt({ format: 'PAYGUARD_RECEIPT_ARCHIVE_V1',
      createdAt: '2026-08-13T00:00:00.000Z', records: [{ id: 'receipt-1',
        transactionId: 'transaction-1', businessId: 'business-1',
        fileName: 'proof.pdf', mimeType: 'application/pdf',
        fileSizeBytes: evidence.byteLength, fileHash: sha256(evidence),
        submittedByUserId: 'user-1', createdAt: '2025-01-01T00:00:00.000Z',
        evidenceBase64: evidence.toString('base64') }] });
    findRecord.mockResolvedValue({ archive_record_id: 'archive-record-1',
      source_record_id: 'receipt-1', business_id: 'business-1', branch_id: null,
      source_created_at: new Date(), storage_object_key: 'archive.pga',
      encrypted_sha256: encrypted.encryptedSha256,
      plaintext_sha256: encrypted.plaintextSha256 });
    storage.getObject.mockResolvedValue(encrypted.body);
    const result = await service.retrieve('batch-1', 'receipt-1',
      'Approved support investigation', admin);
    expect(result.body).toEqual(evidence);
    expect(recordRetrieval).toHaveBeenCalledWith(expect.objectContaining({
      platformAdminId: 'admin-1', reason: 'Approved support investigation',
    }));
  });

  it('does not audit or return a corrupted archive', async () => {
    findRecord.mockResolvedValue({ archive_record_id: 'archive-record-1',
      source_record_id: 'receipt-1', business_id: 'business-1', branch_id: null,
      source_created_at: new Date(), storage_object_key: 'archive.pga',
      encrypted_sha256: '0'.repeat(64), plaintext_sha256: '0'.repeat(64) });
    storage.getObject.mockResolvedValue(Buffer.from('corrupted'));
    await expect(service.retrieve('batch-1', 'receipt-1',
      'Approved support investigation', admin))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(recordRetrieval).not.toHaveBeenCalled();
  });
});
