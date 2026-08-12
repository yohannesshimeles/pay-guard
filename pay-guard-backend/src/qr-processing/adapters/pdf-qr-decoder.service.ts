import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { ProofMimeType } from '../enums/proof-mime-type.enum';
import { ValidatedProofFile } from '../models/proof-file.model';
import { QrDecodeResult, QrDecoderPort } from '../ports/qr-decoder.port';
import { PdfQrWorkerClient } from '../pdf-qr-worker.client';

@Injectable()
export class PdfQrDecoderService implements QrDecoderPort {
  constructor(private readonly worker: PdfQrWorkerClient) {}

  async decode(file: ValidatedProofFile): Promise<QrDecodeResult> {
    if (file.mimeType !== ProofMimeType.PDF) {
      return { supported: false, candidates: [] };
    }
    try {
      const candidates = await this.worker.run(file.body);
      return {
        supported: true,
        candidates: candidates.map((rawValue) => ({ rawValue })),
      };
    } catch {
      throw new UnprocessableEntityException(
        'Proof PDF could not be decoded safely',
      );
    }
  }
}
