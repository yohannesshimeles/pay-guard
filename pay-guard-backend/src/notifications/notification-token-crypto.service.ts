import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type EncryptedNotificationToken = {
  ciphertext: string; iv: string; authTag: string; fingerprint: string;
};

@Injectable()
export class NotificationTokenCryptoService {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const material = config.accountEncryptionKey ?? config.jwtAccessSecret;
    this.key = createHash('sha256')
      .update(`payguard:notification-token:v1:${material}`).digest();
  }

  encrypt(token: string): EncryptedNotificationToken {
    const normalized = token.trim();
    if (normalized.length < 20 || normalized.length > 4096) {
      throw new Error('Invalid push token length');
    }
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(normalized, 'utf8'), cipher.final(),
    ]);
    return {
      ciphertext: ciphertext.toString('base64'),
      iv: iv.toString('base64'),
      authTag: cipher.getAuthTag().toString('base64'),
      fingerprint: createHmac('sha256', this.key)
        .update(`payguard:notification-token-fingerprint:v1:${normalized}`)
        .digest('hex'),
    };
  }

  decrypt(value: Pick<EncryptedNotificationToken, 'ciphertext' | 'iv' | 'authTag'>) {
    const decipher = createDecipheriv('aes-256-gcm', this.key,
      Buffer.from(value.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(value.authTag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(value.ciphertext, 'base64')), decipher.final(),
    ]).toString('utf8');
  }
}

