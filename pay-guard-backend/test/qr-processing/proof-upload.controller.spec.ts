import {
  PayloadTooLargeException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { AppConfig } from '../../src/config/app-config';
import { TransactionReceiptEntity } from '../../src/qr-processing/entities/transaction-receipt.entity';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';
import { QrExtractionState } from '../../src/qr-processing/enums/qr-extraction-state.enum';
import { ProofIntakeService } from '../../src/qr-processing/proof-intake.service';
import { ProofUploadController } from '../../src/qr-processing/proof-upload.controller';
import { TransactionReceiptAccessDao } from '../../src/qr-processing/transaction-receipt-access.dao';
import { VerificationPreparationService } from '../../src/verifications/verification-preparation.service';
import { ReceiptTransactionMatcherService } from '../../src/qr-processing/receipt-transaction-matcher.service';
import { ReceiptMatchDecisionDao } from '../../src/qr-processing/receipt-match-decision.dao';

const principal: AuthenticatedPrincipal = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  role: 'WAITER',
  businessIds: ['00000000-0000-4000-8000-000000000003'],
  branchId: '00000000-0000-4000-8000-000000000004',
};

const transactionId = '00000000-0000-4000-8000-000000000005';

function setup(schema: 'legacy' | 'v2' = 'v2') {
  const access = {
    assertCanUpload: jest.fn().mockResolvedValue({
      businessId: principal.businessIds[0],
      branchId: principal.branchId,
      submittedByUserId: principal.userId,
      transactionReference: 'REF-001',
      amount: '125.50',
      transactionDate: '2026-08-08',
      transactionTime: '12:30:00',
      bankIdentifier: 'CBE',
      accountSuffix: '1234',
    }),
  };
  const verifications = { prepare: jest.fn() };
  const matcher = { match: jest.fn().mockReturnValue({ decision: 'MATCHED' }) };
  const matchDecisions = { record: jest.fn().mockResolvedValue(undefined) };
  const receipt = new TransactionReceiptEntity({
    id: '00000000-0000-4000-8000-000000000006',
    transactionId,
    storageObjectKey: 'private/never-return-this.png',
    fileName: 'receipt.png',
    mimeType: ProofMimeType.PNG,
    fileSizeBytes: 8,
    fileHash: 'a'.repeat(64),
    submittedByUserId: principal.userId,
    createdAt: new Date('2026-08-05T00:00:00.000Z'),
  });
  const intake = {
    inspect: jest.fn().mockResolvedValue({
      file: { body: new Uint8Array(), mimeType: ProofMimeType.PNG },
      extraction: {
        state: QrExtractionState.SINGLE_QR,
        candidates: [{ rawValue: 'never-return-this-qr-value' }],
      },
    }),
    persistReceipt: jest.fn().mockResolvedValue(receipt),
  };
  return {
    controller: new ProofUploadController(
      { databaseSchemaVersion: schema } as AppConfig,
      access as unknown as TransactionReceiptAccessDao,
      intake as unknown as ProofIntakeService,
      verifications as unknown as VerificationPreparationService,
      matcher as unknown as ReceiptTransactionMatcherService,
      matchDecisions as unknown as ReceiptMatchDecisionDao,
    ),
    access,
    intake,
    verifications,
    matcher,
    matchDecisions,
  };
}

function request(part: object | undefined) {
  return { file: jest.fn().mockResolvedValue(part) };
}

describe('ProofUploadController', () => {
  it('rejects the endpoint before V2 cutover', async () => {
    const { controller, access } = setup('legacy');
    await expect(
      controller.upload(transactionId, request(undefined), principal),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(access.assertCanUpload).not.toHaveBeenCalled();
  });

  it('authorizes before reading and returns no protected QR/storage metadata', async () => {
    const { controller, access } = setup();
    const upload = request({
      fieldname: 'proof',
      filename: 'receipt.png',
      mimetype: 'image/png',
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('image')),
    });

    const result = await controller.upload(transactionId, upload, principal);

    expect(access.assertCanUpload).toHaveBeenCalledWith(
      transactionId,
      principal,
    );
    expect(result.extraction).toEqual({
      state: QrExtractionState.SINGLE_QR,
      candidateCount: 1,
    });
    expect(result.verification).toEqual({
      decision: 'REVIEW_REQUIRED',
      reasonCode: 'INCOMPLETE_QR',
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('never-return-this');
    expect(serialized).not.toContain('"fileHash"');
    expect(serialized).not.toContain('"submittedByUserId"');
  });

  it('maps parser file-limit errors to a sanitized 413 response', async () => {
    const { controller } = setup();
    const upload = {
      file: jest.fn().mockRejectedValue({ statusCode: 413, detail: 'parser' }),
    };
    await expect(
      controller.upload(transactionId, upload, principal),
    ).rejects.toBeInstanceOf(PayloadTooLargeException);
  });

  it('prepares verification only after a complete receipt match', async () => {
    const { controller, intake, verifications, matcher, matchDecisions } = setup();
    intake.inspect.mockResolvedValue({
      file: { body: new Uint8Array(), mimeType: ProofMimeType.PNG },
      extraction: {
        state: QrExtractionState.SINGLE_QR,
        candidates: [
          {
            rawValue: 'protected',
            parsed: {
              status: 'COMPLETE',
              bankCode: 'CBE',
              reference: 'REF-001',
              directVerificationSupported: true,
            },
          },
        ],
      },
    });
    verifications.prepare.mockResolvedValue({ decision: 'PREPARED' });
    const result = await controller.upload(
      transactionId,
      request({
        fieldname: 'proof',
        filename: 'receipt.png',
        mimetype: 'image/png',
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('image')),
      }),
      principal,
    );
    expect(matcher.match).toHaveBeenCalled();
    expect(matchDecisions.record).toHaveBeenCalledWith({
      receiptId: '00000000-0000-4000-8000-000000000006',
      transactionId,
      decision: 'MATCHED',
    });
    expect(verifications.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        transactionId,
        attemptKey: `verification:initial:${transactionId}`,
      }),
    );
    expect(result.verification).toEqual({ decision: 'PREPARED' });
  });

  it('does not consume verification credit when receipt fields mismatch', async () => {
    const { controller, intake, verifications, matcher, matchDecisions } = setup();
    intake.inspect.mockResolvedValue({
      file: { body: new Uint8Array(), mimeType: ProofMimeType.PNG },
      extraction: {
        state: QrExtractionState.SINGLE_QR,
        candidates: [
          {
            rawValue: 'protected',
            parsed: {
              status: 'COMPLETE',
              bankCode: 'CBE',
              reference: 'OTHER',
              directVerificationSupported: true,
            },
          },
        ],
      },
    });
    matcher.match.mockReturnValue({
      decision: 'REVIEW_REQUIRED',
      reasonCode: 'REFERENCE_MISMATCH',
    });
    const result = await controller.upload(
      transactionId,
      request({
        fieldname: 'proof',
        filename: 'receipt.png',
        mimetype: 'image/png',
        toBuffer: jest.fn().mockResolvedValue(Buffer.from('image')),
      }),
      principal,
    );
    expect(verifications.prepare).not.toHaveBeenCalled();
    expect(matchDecisions.record).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: 'REFERENCE_MISMATCH' }),
    );
    expect(result.verification).toEqual({
      decision: 'REVIEW_REQUIRED',
      reasonCode: 'REFERENCE_MISMATCH',
    });
  });

  it('never persists evidence when secure inspection rejects the document', async () => {
    const { controller, intake } = setup();
    intake.inspect.mockRejectedValue(
      new UnprocessableEntityException('Proof PDF could not be decoded safely'),
    );
    const upload = request({
      fieldname: 'proof',
      filename: 'hostile.pdf',
      mimetype: 'application/pdf',
      toBuffer: jest.fn().mockResolvedValue(Buffer.from('%PDF-1.7 invalid')),
    });

    await expect(
      controller.upload(transactionId, upload, principal),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(intake.persistReceipt).not.toHaveBeenCalled();
  });
});
