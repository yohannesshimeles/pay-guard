import { ImageQrDecoderService } from '../../src/qr-processing/adapters/image-qr-decoder.service';
import { PdfQrDecoderService } from '../../src/qr-processing/adapters/pdf-qr-decoder.service';
import { ProofQrDecoderService } from '../../src/qr-processing/adapters/proof-qr-decoder.service';
import { ProofFileValidator } from '../../src/qr-processing/proof-file.validator';

const validator = new ProofFileValidator();
const pdf = validator.validate({
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  body: Uint8Array.from(Buffer.from('%PDF-1.7 synthetic')),
});
const png = validator.validate({
  fileName: 'receipt.png',
  mimeType: 'image/png',
  body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
});

describe('ProofQrDecoderService', () => {
  it('delegates PDF and image inputs to isolated adapters', async () => {
    const image = { decode: jest.fn().mockResolvedValue({ supported: true, candidates: [] }) };
    const pdfDecoder = { decode: jest.fn().mockResolvedValue({ supported: true, candidates: [] }) };
    const service = new ProofQrDecoderService(
      image as unknown as ImageQrDecoderService,
      pdfDecoder as unknown as PdfQrDecoderService,
    );

    await service.decode(pdf);
    expect(pdfDecoder.decode).toHaveBeenCalledWith(pdf);
    expect(image.decode).not.toHaveBeenCalled();

    await service.decode(png);
    expect(image.decode).toHaveBeenCalledWith(png);
  });
});
