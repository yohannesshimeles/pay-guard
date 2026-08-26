import { createHash } from 'node:crypto';
import { ArchiveCryptoService } from '../../src/archive/archive-crypto.service';
import { ArchiveDao } from '../../src/archive/archive.dao';
import { ArchiveWorker } from '../../src/archive/archive.worker';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';

describe('ArchiveWorker', () => {
  const body = Buffer.from('old receipt evidence');
  const receipt = { id: 'receipt-1', transactionId: 'transaction-1',
    businessId: 'business-1', branchId: 'branch-1', objectKey: 'proof/original.png',
    fileName: 'original.png', mimeType: 'image/png', fileSizeBytes: body.byteLength,
    fileHash: createHash('sha256').update(body).digest('hex'),
    submittedByUserId: 'user-1', createdAt: new Date('2025-01-01T00:00:00Z') };
  const claimSourceDeletion = jest.fn();
  const claimNext = jest.fn();
  const listEligible = jest.fn();
  const completeBatch = jest.fn();
  const fail = jest.fn();
  const markSourceDeleted = jest.fn();
  const archives = {
    claimSourceDeletion, ensureCurrentJob: jest.fn(), claimNext,
    listEligible, completeBatch, completeJob: jest.fn(), fail,
    markSourceDeleted, markSourceDeleteFailed: jest.fn(),
  } as unknown as jest.Mocked<ArchiveDao>;
  const objects = new Map<string, Uint8Array>([[receipt.objectKey, body]]);
  const deleteObject = jest.fn((key: string) => {
    objects.delete(key);
    return Promise.resolve();
  });
  const storage: ObjectStoragePort = {
    isReady: jest.fn(),
    putObject: jest.fn((key, value) => {
      objects.set(key, value);
      return Promise.resolve();
    }),
    getObject: jest.fn((key) => {
      const value = objects.get(key);
      if (!value) throw new Error('missing');
      return Promise.resolve(value);
    }),
    deleteObject,
  };
  const crypto = new ArchiveCryptoService({
    archiveEncryptionKey: 'archive-secret-that-is-longer-than-thirty-two-characters',
  } as never);
  const worker = new ArchiveWorker(archives, crypto, storage);

  beforeEach(() => {
    jest.clearAllMocks();
    objects.clear();
    objects.set(receipt.objectKey, body);
    claimSourceDeletion.mockResolvedValue(undefined);
    claimNext.mockResolvedValue({ jobId: 'job-1', jobMonth: '2026-08-01',
      claimToken: 'claim-1', attemptNo: 1 });
  });

  it('encrypts, re-reads and verifies evidence before marking it archived', async () => {
    listEligible.mockResolvedValue([receipt]);
    expect(await worker.processNext(new Date('2026-08-13T00:00:00Z')))
      .toBe('ARCHIVED');
    const call = completeBatch.mock.calls[0] as unknown as [
      { jobId: string }, { records: unknown[]; encryptedSha256: string;
        plaintextSha256: string },
    ];
    expect(call[0].jobId).toBe('job-1');
    expect(call[1].records).toEqual([receipt]);
    expect(call[1].encryptedSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(call[1].plaintextSha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(deleteObject).not.toHaveBeenCalledWith(receipt.objectKey);
  });

  it('never marks or deletes the source when source integrity fails', async () => {
    listEligible.mockResolvedValue([{ ...receipt, fileHash: '0'.repeat(64) }]);
    expect(await worker.processNext(new Date('2026-08-13T00:00:00Z')))
      .toBe('DEFERRED');
    expect(completeBatch).not.toHaveBeenCalled();
    expect(objects.has(receipt.objectKey)).toBe(true);
    expect(fail).toHaveBeenCalled();
  });

  it('retries source deletion separately after a verified durable batch', async () => {
    claimSourceDeletion.mockResolvedValue({ id: 'deletion-1',
      objectKey: receipt.objectKey, archiveRecordId: 'archive-record-1',
      sourceRecordId: receipt.id, businessId: receipt.businessId,
      branchId: receipt.branchId });
    expect(await worker.processNext()).toBe('SOURCE_DELETED');
    expect(markSourceDeleted).toHaveBeenCalledWith(expect.objectContaining({
      id: 'deletion-1', sourceRecordId: receipt.id,
    }));
    expect(claimNext).not.toHaveBeenCalled();
  });
});
