import { AppConfig, DEFAULT_CLAMAV_CONFIG, DEFAULT_DATABASE_POOL_CONFIG,
  DEFAULT_FIREBASE_CONFIG, DEFAULT_VERIFYET_CONFIG } from '../../src/config/app-config';
import { ArchiveCryptoService } from '../../src/archive/archive-crypto.service';

const config: AppConfig = {
  environment: 'test', port: 4000, logLevel: 'error',
  databaseSchemaVersion: 'v2', databaseUrl: 'postgresql://test:test@localhost/test',
  databasePool: DEFAULT_DATABASE_POOL_CONFIG, clamav: DEFAULT_CLAMAV_CONFIG,
  verifyEt: DEFAULT_VERIFYET_CONFIG, firebase: DEFAULT_FIREBASE_CONFIG,
  notificationWorkerPollMs: 2_000, redisUrl: 'redis://localhost:6379',
  jwtAccessSecret: 'jwt-secret-that-is-longer-than-thirty-two-characters',
  accountEncryptionKey: 'account-secret-that-is-longer-than-thirty-two-characters',
  archiveEncryptionKey: 'archive-secret-that-is-longer-than-thirty-two-characters',
  jwtAccessTtlSeconds: 900, refreshTokenTtlSeconds: 2_592_000,
  passwordResetTtlSeconds: 1_800,
  s3: { endpoint: 'http://localhost:9000', region: 'us-east-1', bucket: 'test',
    accessKeyId: 'test', secretAccessKey: 'test-secret-long-enough',
    forcePathStyle: true },
};

describe('ArchiveCryptoService', () => {
  const crypto = new ArchiveCryptoService(config);
  const value = {
    format: 'PAYGUARD_RECEIPT_ARCHIVE_V1' as const,
    createdAt: '2026-08-13T00:00:00.000Z',
    records: [{ id: 'receipt-1', transactionId: 'transaction-1',
      businessId: 'business-1', fileName: 'proof.png', mimeType: 'image/png',
      fileSizeBytes: 5, fileHash: 'hash', submittedByUserId: 'user-1',
      createdAt: '2025-01-01T00:00:00.000Z',
      evidenceBase64: Buffer.from('proof').toString('base64') }],
  };

  it('round-trips an authenticated encrypted archive package', () => {
    const encrypted = crypto.encrypt(value);
    expect(Buffer.from(encrypted.body).toString('utf8')).not.toContain('proof.png');
    expect(crypto.decrypt(encrypted.body, encrypted)).toEqual(value);
  });

  it('rejects encrypted package tampering', () => {
    const encrypted = crypto.encrypt(value);
    const tampered = Uint8Array.from(encrypted.body);
    tampered[tampered.length - 2] ^= 1;
    expect(() => crypto.decrypt(tampered, encrypted))
      .toThrow('Archive encrypted checksum mismatch');
  });

  it('decrypts old archives after managed-key rotation and rejects retired keys', () => {
    const oldConfig = { ...config, archiveEncryptionKeyId: '2026-q1',
      archiveEncryptionKey: 'old-archive-key-that-is-longer-than-thirty-two-characters' };
    const encrypted = new ArchiveCryptoService(oldConfig).encrypt(value);
    const rotatedConfig = { ...config, archiveEncryptionKeyId: '2026-q2',
      archiveEncryptionKey: 'new-archive-key-that-is-longer-than-thirty-two-characters',
      archivePreviousEncryptionKeys: {
        '2026-q1': 'old-archive-key-that-is-longer-than-thirty-two-characters',
      } };

    expect(new ArchiveCryptoService(rotatedConfig).decrypt(encrypted.body, encrypted))
      .toEqual(value);
    expect(() => new ArchiveCryptoService({ ...rotatedConfig,
      archivePreviousEncryptionKeys: {} }).decrypt(encrypted.body, encrypted))
      .toThrow('Archive encryption key is unavailable');
  });
});
