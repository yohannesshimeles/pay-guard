import { QrExtractionState } from '../enums/qr-extraction-state.enum';
import { ParsedQrPayloadModel } from './parsed-qr-payload.model';

export type QrCandidateModel = {
  rawValue: string;
  parsed?: ParsedQrPayloadModel;
};

export type QrExtractionModel = {
  state: QrExtractionState;
  candidates: readonly QrCandidateModel[];
};

export function extractionStateFor(
  candidates: readonly QrCandidateModel[],
): Exclude<QrExtractionState, QrExtractionState.UNSUPPORTED_PROOF> {
  if (candidates.length === 0) return QrExtractionState.NO_QR;
  if (candidates.length === 1) return QrExtractionState.SINGLE_QR;
  return QrExtractionState.MULTIPLE_QR;
}

export function createQrExtraction(
  candidates: readonly QrCandidateModel[],
): QrExtractionModel {
  return {
    state: extractionStateFor(candidates),
    candidates: [...candidates],
  };
}
