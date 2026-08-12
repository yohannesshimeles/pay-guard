import { ProofMimeType } from '../enums/proof-mime-type.enum';
import { ReceiptPublicModel } from '../models/receipt-public.model';

export type TransactionReceiptEntityProps = {
  id: string;
  transactionId: string;
  storageObjectKey: string;
  fileName: string;
  mimeType: ProofMimeType;
  fileSizeBytes: number;
  fileHash: string;
  submittedByUserId: string;
  createdAt: Date;
  archivedAt?: Date;
};

export class TransactionReceiptEntity {
  readonly id: string;
  readonly transactionId: string;
  readonly storageObjectKey: string;
  readonly fileName: string;
  readonly mimeType: ProofMimeType;
  readonly fileSizeBytes: number;
  readonly fileHash: string;
  readonly submittedByUserId: string;
  readonly createdAt: Date;
  readonly archivedAt?: Date;

  constructor(props: TransactionReceiptEntityProps) {
    this.id = props.id;
    this.transactionId = props.transactionId;
    this.storageObjectKey = props.storageObjectKey;
    this.fileName = props.fileName;
    this.mimeType = props.mimeType;
    this.fileSizeBytes = props.fileSizeBytes;
    this.fileHash = props.fileHash;
    this.submittedByUserId = props.submittedByUserId;
    this.createdAt = props.createdAt;
    this.archivedAt = props.archivedAt;
  }

  toPublicModel(): ReceiptPublicModel {
    return {
      id: this.id,
      transactionId: this.transactionId,
      fileName: this.fileName,
      mimeType: this.mimeType,
      fileSizeBytes: this.fileSizeBytes,
      createdAt: this.createdAt,
      archived: this.archivedAt !== undefined,
    };
  }
}
