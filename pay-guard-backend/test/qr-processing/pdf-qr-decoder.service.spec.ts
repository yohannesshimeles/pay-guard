import { UnprocessableEntityException } from '@nestjs/common';
import { PdfQrDecoderService } from '../../src/qr-processing/adapters/pdf-qr-decoder.service';
import { ProofMimeType } from '../../src/qr-processing/enums/proof-mime-type.enum';
import { PdfQrWorkerClient } from '../../src/qr-processing/pdf-qr-worker.client';
import { ProofFileValidator } from '../../src/qr-processing/proof-file.validator';

const pdf = new ProofFileValidator().validate({
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  body: Uint8Array.from(Buffer.from('%PDF-1.7 synthetic')),
});
const png = new ProofFileValidator().validate({
  fileName: 'receipt.png',
  mimeType: 'image/png',
  body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
});

describe('PdfQrDecoderService', () => {
  it('maps bounded worker candidates into the decoder port', async () => {
    const worker = { run: jest.fn().mockResolvedValue(['first', 'second']) };
    const service = new PdfQrDecoderService(
      worker as unknown as PdfQrWorkerClient,
    );

    await expect(service.decode(pdf)).resolves.toEqual({
      supported: true,
      candidates: [{ rawValue: 'first' }, { rawValue: 'second' }],
    });
    expect(worker.run).toHaveBeenCalledWith(pdf.body);
  });

  it('does not send image inputs to the PDF worker', async () => {
    const worker = { run: jest.fn() };
    const service = new PdfQrDecoderService(
      worker as unknown as PdfQrWorkerClient,
    );
    await expect(service.decode(png)).resolves.toEqual({
      supported: false,
      candidates: [],
    });
    expect(worker.run).not.toHaveBeenCalled();
  });

  it('sanitizes worker parser, timeout and resource failures', async () => {
    const worker = { run: jest.fn().mockRejectedValue(new Error('native detail')) };
    const service = new PdfQrDecoderService(
      worker as unknown as PdfQrWorkerClient,
    );
    await expect(service.decode(pdf)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
    await expect(service.decode(pdf)).rejects.toThrow(
      'Proof PDF could not be decoded safely',
    );
  });

  it('keeps the PDF MIME value aligned with the validated model', () => {
    expect(pdf.mimeType).toBe(ProofMimeType.PDF);
  });
});
