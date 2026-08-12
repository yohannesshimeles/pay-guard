import { ProofMimeType } from './enums/proof-mime-type.enum';

export { MalwareScanStatus } from './enums/malware-scan-status.enum';
export { ProofMimeType } from './enums/proof-mime-type.enum';
export { ProofSubmissionMethod } from './enums/proof-submission-method.enum';
export { QrExtractionState } from './enums/qr-extraction-state.enum';
export type {
  MalwareScanResult,
  ProofFileInput,
  StoredProofModel,
  ValidatedProofFile,
} from './models/proof-file.model';
export {
  createQrExtraction,
  extractionStateFor,
} from './models/qr-extraction.model';
export type {
  QrCandidateModel as QrCandidate,
  QrExtractionModel,
} from './models/qr-extraction.model';

export const PROOF_MIME_TYPES = Object.values(ProofMimeType);
