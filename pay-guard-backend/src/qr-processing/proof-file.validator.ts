import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import {
  PROOF_MIME_TYPES,
  ProofFileInput,
  ProofMimeType,
  ValidatedProofFile,
} from './proof-file.types';

export const DEFAULT_MAX_PROOF_BYTES = 10 * 1024 * 1024;
export const MAX_PROOF_BYTES = Symbol('MAX_PROOF_BYTES');

const extensionsByMimeType: Record<ProofMimeType, readonly string[]> = {
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'application/pdf': ['.pdf'],
};

@Injectable()
export class ProofFileValidator {
  private readonly maxBytes: number;

  constructor(
    @Optional() @Inject(MAX_PROOF_BYTES) maxBytes = DEFAULT_MAX_PROOF_BYTES,
  ) {
    this.maxBytes = maxBytes;
  }

  validate(input: ProofFileInput): ValidatedProofFile {
    const fileName = input.fileName.trim();
    if (!this.isSafeFileName(fileName)) {
      throw new BadRequestException('Proof filename is invalid');
    }

    if (!this.isSupportedMimeType(input.mimeType)) {
      throw new BadRequestException('Proof file type is not supported');
    }

    if (input.body.byteLength === 0) {
      throw new BadRequestException('Proof file is empty');
    }
    if (input.body.byteLength > this.maxBytes) {
      throw new BadRequestException(
        'Proof file exceeds the configured size limit',
      );
    }

    if (!this.extensionMatches(fileName, input.mimeType)) {
      throw new BadRequestException(
        'Proof filename and content type do not match',
      );
    }
    if (!this.signatureMatches(input.body, input.mimeType)) {
      throw new BadRequestException(
        'Proof content does not match its declared type',
      );
    }

    return {
      fileName,
      mimeType: input.mimeType,
      sizeBytes: input.body.byteLength,
      sha256: createHash('sha256').update(input.body).digest('hex'),
      body: input.body,
    };
  }

  private isSafeFileName(fileName: string): boolean {
    return (
      fileName.length > 0 &&
      fileName.length <= 255 &&
      !fileName.includes('/') &&
      !fileName.includes('\\') &&
      !this.containsControlCharacter(fileName)
    );
  }

  private containsControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
      const characterCode = value.charCodeAt(index);
      if (characterCode <= 0x1f || characterCode === 0x7f) return true;
    }
    return false;
  }

  private isSupportedMimeType(mimeType: string): mimeType is ProofMimeType {
    return (PROOF_MIME_TYPES as readonly string[]).includes(mimeType);
  }

  private extensionMatches(fileName: string, mimeType: ProofMimeType): boolean {
    const lowerName = fileName.toLowerCase();
    return extensionsByMimeType[mimeType].some((extension) =>
      lowerName.endsWith(extension),
    );
  }

  private signatureMatches(body: Uint8Array, mimeType: ProofMimeType): boolean {
    if (mimeType === ProofMimeType.JPEG) {
      return (
        body.length >= 3 &&
        body[0] === 0xff &&
        body[1] === 0xd8 &&
        body[2] === 0xff
      );
    }
    if (mimeType === ProofMimeType.PNG) {
      const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
      return signature.every((value, index) => body[index] === value);
    }
    return (
      body.length >= 5 &&
      body[0] === 0x25 &&
      body[1] === 0x50 &&
      body[2] === 0x44 &&
      body[3] === 0x46 &&
      body[4] === 0x2d
    );
  }
}
