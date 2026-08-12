import { TransactionReceiptEntity } from '../../src/qr-processing/entities/transaction-receipt.entity';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';

describe('TransactionReceiptEntity', () => {
  it('maps to a public model without exposing storage or hash metadata', () => {
    const receipt = new TransactionReceiptEntity({
      id: 'receipt-id',
      transactionId: 'transaction-id',
      storageObjectKey: 'private/business/receipt-id.pdf',
      fileName: 'receipt.pdf',
      mimeType: ProofMimeType.PDF,
      fileSizeBytes: 1024,
      fileHash: 'a'.repeat(64),
      submittedByUserId: 'user-id',
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
    });

    const result = receipt.toPublicModel();

    expect(result).toEqual({
      id: 'receipt-id',
      transactionId: 'transaction-id',
      fileName: 'receipt.pdf',
      mimeType: 'application/pdf',
      fileSizeBytes: 1024,
      createdAt: new Date('2026-08-05T12:00:00.000Z'),
      archived: false,
    });
    expect(result).not.toHaveProperty('storageObjectKey');
    expect(result).not.toHaveProperty('fileHash');
    expect(result).not.toHaveProperty('submittedByUserId');
  });
});
