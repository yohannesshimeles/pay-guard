import { ValidatedProofFile } from '../models/proof-file.model';
import { QrCandidateModel } from '../models/qr-extraction.model';

export const QR_DECODER = Symbol('QR_DECODER');

export type QrDecodeResult =
  | { supported: true; candidates: readonly QrCandidateModel[] }
  | { supported: false; candidates: readonly [] };

export interface QrDecoderPort {
  decode(file: ValidatedProofFile): Promise<QrDecodeResult>;
}
