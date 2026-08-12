import { ProofMimeType } from '../enums/proof-mime-type.enum';

export type ReceiptPublicModel = {
  id: string;
  transactionId: string;
  fileName: string;
  mimeType: ProofMimeType;
  fileSizeBytes: number;
  createdAt: Date;
  archived: boolean;
};
