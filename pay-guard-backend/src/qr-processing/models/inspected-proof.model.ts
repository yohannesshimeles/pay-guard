import { ValidatedProofFile } from './proof-file.model';
import { QrExtractionModel } from './qr-extraction.model';

export type InspectedProofModel = {
  file: ValidatedProofFile;
  extraction: QrExtractionModel;
};
