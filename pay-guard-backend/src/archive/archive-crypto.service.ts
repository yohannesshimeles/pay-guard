import {
  createCipheriv, createDecipheriv, createHash, randomBytes,
} from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';

export type ReceiptArchiveRecord = Readonly<{
  id: string;
  transactionId: string;
  businessId: string;
  branchId?: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  submittedByUserId: string;
  createdAt: string;
  evidenceBase64: string;
}>;

export type ReceiptArchivePackage = Readonly<{
  format: 'PAYGUARD_RECEIPT_ARCHIVE_V1';
  createdAt: string;
  records: ReceiptArchiveRecord[];
}>;

type LegacyEncryptedEnvelope = {
  version: 1;
  algorithm: 'AES-256-GCM';
  iv: string;
  tag: string;
  ciphertext: string;
};

type EncryptedEnvelope = Omit<LegacyEncryptedEnvelope, 'version'> & {
  version: 2;
  keyId: string;
};

@Injectable()
export class ArchiveCryptoService {
  private readonly currentKeyId: string;
  private readonly keys: ReadonlyMap<string, Buffer>;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.currentKeyId = config.archiveEncryptionKeyId ?? 'primary';
    const secrets = new Map<string, string>(Object.entries(
      config.archivePreviousEncryptionKeys ?? {},
    ));
    secrets.set(this.currentKeyId, config.archiveEncryptionKey ??
      config.accountEncryptionKey ?? config.jwtAccessSecret);
    this.keys = new Map(Array.from(secrets, ([id, secret]) => [
      id, deriveKey(secret),
    ]));
  }

  encrypt(value: ReceiptArchivePackage): {
    body: Uint8Array; plaintextSha256: string; encryptedSha256: string;
  } {
    const plaintext = Buffer.from(JSON.stringify(value), 'utf8');
    const iv = randomBytes(12);
    const cipher = createCipheriv(
      'aes-256-gcm', this.requireKey(this.currentKeyId), iv,
    );
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    const envelope: EncryptedEnvelope = {
      version: 2, keyId: this.currentKeyId, algorithm: 'AES-256-GCM',
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
    const body = Buffer.from(JSON.stringify(envelope), 'utf8');
    return {
      body,
      plaintextSha256: sha256(plaintext),
      encryptedSha256: sha256(body),
    };
  }

  decrypt(body: Uint8Array, expected: {
    encryptedSha256: string; plaintextSha256: string;
  }): ReceiptArchivePackage {
    const encrypted = Buffer.from(body);
    if (sha256(encrypted) !== expected.encryptedSha256) {
      throw new Error('Archive encrypted checksum mismatch');
    }
    const envelope = this.parseEnvelope(encrypted);
    const plaintext = envelope.version === 1
      ? this.decryptLegacy(envelope)
      : this.decryptWithKey(envelope, this.requireKey(envelope.keyId));
    if (sha256(plaintext) !== expected.plaintextSha256) {
      throw new Error('Archive plaintext checksum mismatch');
    }
    const value = JSON.parse(plaintext.toString('utf8')) as ReceiptArchivePackage;
    if (value.format !== 'PAYGUARD_RECEIPT_ARCHIVE_V1' ||
        !Array.isArray(value.records)) {
      throw new Error('Archive package format is invalid');
    }
    return value;
  }

  private parseEnvelope(body: Buffer): EncryptedEnvelope | LegacyEncryptedEnvelope {
    const value = JSON.parse(body.toString('utf8')) as EncryptedEnvelope;
    if (![1, 2].includes(value.version) || value.algorithm !== 'AES-256-GCM' ||
        typeof value.iv !== 'string' || typeof value.tag !== 'string' ||
        typeof value.ciphertext !== 'string' ||
        (value.version === 2 && typeof value.keyId !== 'string')) {
      throw new Error('Archive encryption envelope is invalid');
    }
    return value;
  }

  private decryptLegacy(envelope: LegacyEncryptedEnvelope): Buffer {
    for (const key of this.keys.values()) {
      try { return this.decryptWithKey(envelope, key); } catch { /* next key */ }
    }
    throw new Error('Archive encryption key is unavailable');
  }

  private decryptWithKey(
    envelope: EncryptedEnvelope | LegacyEncryptedEnvelope, key: Buffer,
  ): Buffer {
    const decipher = createDecipheriv(
      'aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]);
  }

  private requireKey(id: string): Buffer {
    const key = this.keys.get(id);
    if (!key) throw new Error('Archive encryption key is unavailable');
    return key;
  }
}

function deriveKey(secret: string): Buffer {
  return createHash('sha256').update(secret, 'utf8').digest();
}

export function sha256(value: Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
