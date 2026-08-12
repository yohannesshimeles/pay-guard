import { loadConfig } from '../../src/config/app-config';
import { NotificationTokenCryptoService } from '../../src/notifications/notification-token-crypto.service';

describe('NotificationTokenCryptoService', () => {
  const service = new NotificationTokenCryptoService(loadConfig({
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@localhost/test',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-jwt-secret-that-is-longer-than-thirty-two-characters',
    ACCOUNT_ENCRYPTION_KEY: 'isolated-encryption-key-longer-than-thirty-two-characters',
    S3_ENDPOINT: 'http://localhost:9000', S3_BUCKET: 'test',
    S3_ACCESS_KEY_ID: 'test', S3_SECRET_ACCESS_KEY: 'test-secret-long-enough',
  }));

  it('round-trips without retaining the plaintext token', () => {
    const plaintext = 'firebase-device-token-with-sensitive-material';
    const encrypted = service.encrypt(plaintext);
    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(encrypted.fingerprint).toHaveLength(64);
    expect(service.decrypt(encrypted)).toBe(plaintext);
  });

  it('uses randomized authenticated encryption', () => {
    const token = 'firebase-device-token-with-sensitive-material';
    expect(service.encrypt(token).ciphertext)
      .not.toBe(service.encrypt(token).ciphertext);
  });
});
