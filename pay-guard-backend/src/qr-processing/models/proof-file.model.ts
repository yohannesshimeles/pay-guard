import { MalwareScanStatus } from '../enums/malware-scan-status.enum';
import { ProofMimeType } from '../enums/proof-mime-type.enum';

export type ProofFileInput = {
  fileName: string;
  mimeType: string;
  body: Uint8Array;
};

export type ValidatedProofFile = {
  fileName: string;
  mimeType: ProofMimeType;
  sizeBytes: number;
  sha256: string;
  body: Uint8Array;
};

export type MalwareScanResult = {
  status: MalwareScanStatus;
  scannerReference?: string;
};

export type StoredProofModel = {
  objectKey: string;
  fileName: string;
  mimeType: ProofMimeType;
  sizeBytes: number;
  sha256: string;
};
