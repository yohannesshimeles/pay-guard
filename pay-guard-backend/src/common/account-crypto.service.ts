import { Inject, Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type EncryptedAccountValue = {
  ciphertext: string;
  iv: string;
  authTag: string;
  mask: string;
  suffix: string;
  fingerprint: string;
};

@Injectable()
export class AccountCryptoService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const material = config.accountEncryptionKey ?? config.jwtAccessSecret;
    this.key = createHash('sha256')
      .update(`payguard:settlement-account:v1:${material}`)
      .digest();
  }

  encrypt(rawValue: string): EncryptedAccountValue {
    const normalized = rawValue.replace(/[\s-]/g, '');
    const digits = normalized.replace(/\D/g, '');
    if (digits.length < 4) {
      throw new Error('Account value must contain at least four digits');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(normalized, 'utf8'),
      cipher.final(),
    ]);
    const suffix = digits.slice(-Math.min(8, digits.length));
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      mask: `${'*'.repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`,
      suffix,
      fingerprint: createHmac('sha256', this.key)
        .update(`payguard:account-fingerprint:v1:${normalized}`)
        .digest('hex'),
    };
  }

  decrypt(value: Pick<EncryptedAccountValue, 'ciphertext' | 'iv' | 'authTag'>): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(value.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }
}
