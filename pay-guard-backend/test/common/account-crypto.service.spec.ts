import { AccountCryptoService } from '../../src/common/account-crypto.service';
import { AppConfig } from '../../src/config/app-config';

const config = {
  jwtAccessSecret: 'jwt-secret-that-is-long-enough-for-tests',
  accountEncryptionKey: 'separate-account-key-that-is-long-enough',
} as AppConfig;

describe('AccountCryptoService', () => {
  const crypto = new AccountCryptoService(config);

  it('encrypts with AES-GCM and returns only a safe mask and suffix', () => {
    const encrypted = crypto.encrypt('1000-2000-3000-4567');

    expect(encrypted.ciphertext).not.toContain('1000200030004567');
    expect(encrypted.mask).toBe('************4567');
    expect(encrypted.suffix).toBe('30004567');
    expect(encrypted.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(crypto.decrypt(encrypted)).toBe('1000200030004567');
  });

  it('uses a stable keyed fingerprint without weakening randomized encryption', () => {
    const first = crypto.encrypt('1000-2000-3000-4567');
    const second = crypto.encrypt('1000200030004567');

    expect(first.fingerprint).toBe(second.fingerprint);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('uses a fresh IV for each encryption', () => {
    const first = crypto.encrypt('12345678');
    const second = crypto.encrypt('12345678');

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it('rejects values without four digits', () => {
    expect(() => crypto.encrypt('abc-12')).toThrow(
      'Account value must contain at least four digits',
    );
  });
});
