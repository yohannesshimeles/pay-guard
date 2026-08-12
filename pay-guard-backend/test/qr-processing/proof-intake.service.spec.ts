import {
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TransactionReceiptEntity } from '../../src/qr-processing/entities/transaction-receipt.entity';
import { MalwareScanStatus } from '../../src/qr-processing/enums/malware-scan-status.enum';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';
import { QrExtractionState } from '../../src/qr-processing/enums/qr-extraction-state.enum';
import { MalwareScannerPort } from '../../src/qr-processing/ports/malware-scanner.port';
import { QrDecoderPort } from '../../src/qr-processing/ports/qr-decoder.port';
import { ProofFileValidator } from '../../src/qr-processing/proof-file.validator';
import { ProofIntakeService } from '../../src/qr-processing/proof-intake.service';
import { TransactionReceiptDao } from '../../src/qr-processing/transaction-receipt.dao';
import { ObjectStoragePort } from '../../src/storage/object-storage.port';

describe('ProofIntakeService', () => {
  const malwareScan = jest.fn<
    ReturnType<MalwareScannerPort['scan']>,
    Parameters<MalwareScannerPort['scan']>
  >();
  const decoderDecode = jest.fn<
    ReturnType<QrDecoderPort['decode']>,
    Parameters<QrDecoderPort['decode']>
  >();
  const storagePut = jest.fn<
    ReturnType<ObjectStoragePort['putObject']>,
    Parameters<ObjectStoragePort['putObject']>
  >();
  const storageDelete = jest.fn<
    ReturnType<ObjectStoragePort['deleteObject']>,
    Parameters<ObjectStoragePort['deleteObject']>
  >();
  const receiptCreate = jest.fn<
    ReturnType<TransactionReceiptDao['create']>,
    Parameters<TransactionReceiptDao['create']>
  >();
  const malware = { scan: malwareScan } as unknown as MalwareScannerPort;
  const decoder = { decode: decoderDecode } as unknown as QrDecoderPort;
  const storage = {
    isReady: jest.fn(),
    putObject: storagePut,
    deleteObject: storageDelete,
  } as unknown as ObjectStoragePort;
  const receipts = { create: receiptCreate } as unknown as TransactionReceiptDao;
  const service = new ProofIntakeService(
    new ProofFileValidator(),
    malware,
    decoder,
    storage,
    receipts,
  );
  const input = {
    fileName: 'receipt.pdf',
    mimeType: 'application/pdf',
    body: Uint8Array.from(Buffer.from('%PDF-1.7')),
  };

  beforeEach(() => jest.clearAllMocks());

  it('scans before decoding and returns the decoder outcome', async () => {
    malwareScan.mockResolvedValue({
      status: MalwareScanStatus.CLEAN,
    });
    decoderDecode.mockResolvedValue({
      supported: true,
      candidates: [{ rawValue: 'qr-value' }],
    });

    const result = await service.inspect(input);

    expect(result.extraction.state).toBe(QrExtractionState.SINGLE_QR);
    expect(result.extraction.candidates[0]).toMatchObject({
      rawValue: 'qr-value',
      parsed: { status: 'UNRECOGNIZED' },
    });
    expect(malwareScan).toHaveBeenCalledTimes(1);
    expect(decoderDecode).toHaveBeenCalledTimes(1);
  });

  it('fails closed and never decodes infected or unavailable scans', async () => {
    malwareScan.mockResolvedValue({
      status: MalwareScanStatus.INFECTED,
    });
    await expect(service.inspect(input)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    expect(decoderDecode).not.toHaveBeenCalled();

    malwareScan.mockResolvedValue({
      status: MalwareScanStatus.ERROR,
    });
    await expect(service.inspect(input)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(decoderDecode).not.toHaveBeenCalled();
  });

  it('models unsupported proof without inventing QR content', async () => {
    malwareScan.mockResolvedValue({
      status: MalwareScanStatus.CLEAN,
    });
    decoderDecode.mockResolvedValue({
      supported: false,
      candidates: [],
    });

    await expect(service.inspect(input)).resolves.toMatchObject({
      extraction: {
        state: QrExtractionState.UNSUPPORTED_PROOF,
        candidates: [],
      },
    });
  });

  it('uses a server-generated private key and persists only receipt metadata', async () => {
    storagePut.mockResolvedValue(undefined);
    receiptCreate.mockResolvedValue(
      new TransactionReceiptEntity({
        id: 'receipt-id',
        transactionId: 'transaction-id',
        storageObjectKey: 'private/transaction-receipts/receipt.pdf',
        fileName: 'receipt.pdf',
        mimeType: ProofMimeType.PDF,
        fileSizeBytes: input.body.byteLength,
        fileHash: 'a'.repeat(64),
        submittedByUserId: 'user-id',
        createdAt: new Date('2026-08-05T12:00:00.000Z'),
      }),
    );
    const inspected = {
      file: new ProofFileValidator().validate(input),
      extraction: {
        state: QrExtractionState.SINGLE_QR,
        candidates: [{ rawValue: 'qr-value' }],
      },
    };

    await service.persistReceipt('transaction-id', 'user-id', inspected);

    const [privateKey] = storagePut.mock.calls[0];
    expect(privateKey).toMatch(
      /^private\/transaction-receipts\/[0-9a-f-]{36}\.pdf$/u,
    );
    expect(storagePut).toHaveBeenCalledWith(
      privateKey,
      inspected.file.body,
      inspected.file.mimeType,
    );
    const [createInput] = receiptCreate.mock.calls[0];
    expect(createInput).toMatchObject({
      transactionId: 'transaction-id',
      submittedByUserId: 'user-id',
      proof: { objectKey: privateKey },
    });
  });

  it('deletes the private object when receipt persistence fails', async () => {
    storagePut.mockResolvedValue(undefined);
    storageDelete.mockResolvedValue(undefined);
    receiptCreate.mockRejectedValue(new Error('database failure'));
    const inspected = {
      file: new ProofFileValidator().validate(input),
      extraction: { state: QrExtractionState.NO_QR, candidates: [] },
    };

    await expect(
      service.persistReceipt('transaction-id', 'user-id', inspected),
    ).rejects.toThrow('database failure');
    expect(storageDelete).toHaveBeenCalledWith(
      expect.stringMatching(/^private\/transaction-receipts\//u),
    );
  });
});
