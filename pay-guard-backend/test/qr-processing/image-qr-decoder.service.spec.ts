import { UnprocessableEntityException } from '@nestjs/common';
import { ImageQrDecoderService } from '../../src/qr-processing/adapters/image-qr-decoder.service';
import { ProofFileValidator } from '../../src/qr-processing/proof-file.validator';

const validator = new ProofFileValidator();
const png = validator.validate({
  fileName: 'receipt.png',
  mimeType: 'image/png',
  body: Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
});
const pdf = validator.validate({
  fileName: 'receipt.pdf',
  mimeType: 'application/pdf',
  body: Uint8Array.from(Buffer.from('%PDF-1.7 receipt')),
});

const pixels = new Uint8ClampedArray(4 * 2 * 2);

describe('ImageQrDecoderService', () => {
  it('returns unsupported for PDF without invoking the image rasterizer', async () => {
    const rasterize = jest.fn();
    const service = new ImageQrDecoderService(rasterize, jest.fn());

    await expect(service.decode(pdf)).resolves.toEqual({
      supported: false,
      candidates: [],
    });
    expect(rasterize).not.toHaveBeenCalled();
  });

  it('returns NO_QR input when no QR pixels are found', async () => {
    const service = new ImageQrDecoderService(
      jest.fn().mockResolvedValue({ pixels, width: 2, height: 2 }),
      jest.fn().mockReturnValue(null),
    );

    await expect(service.decode(png)).resolves.toEqual({
      supported: true,
      candidates: [],
    });
  });

  it('returns one trimmed internal QR candidate', async () => {
    const decodePixels = jest.fn().mockReturnValue({ data: ' bank:value ' });
    const service = new ImageQrDecoderService(
      jest.fn().mockResolvedValue({ pixels, width: 2, height: 2 }),
      decodePixels,
    );

    await expect(service.decode(png)).resolves.toEqual({
      supported: true,
      candidates: [{ rawValue: 'bank:value' }],
    });
    expect(decodePixels).toHaveBeenCalledWith(pixels, 2, 2, {
      inversionAttempts: 'dontInvert',
    });
  });

  it('detects multiple located QR codes with a bounded masking loop', async () => {
    const width = 32;
    const height = 16;
    const imagePixels = new Uint8ClampedArray(width * height * 4);
    const location = (left: number) => ({
      topLeftCorner: { x: left, y: 2 },
      topRightCorner: { x: left + 5, y: 2 },
      bottomLeftCorner: { x: left, y: 7 },
      bottomRightCorner: { x: left + 5, y: 7 },
    });
    const decodePixels = jest
      .fn()
      .mockReturnValueOnce({ data: 'first-code', location: location(1) })
      .mockReturnValueOnce({ data: 'second-code', location: location(20) })
      .mockReturnValueOnce(null);
    const service = new ImageQrDecoderService(
      jest.fn().mockResolvedValue({
        pixels: imagePixels,
        width,
        height,
      }),
      decodePixels,
    );

    await expect(service.decode(png)).resolves.toEqual({
      supported: true,
      candidates: [
        { rawValue: 'first-code' },
        { rawValue: 'second-code' },
      ],
    });
    expect(decodePixels).toHaveBeenCalledTimes(3);
  });

  it('stops at four candidates to bound image-processing cost', async () => {
    const width = 80;
    const height = 20;
    const decodePixels = jest.fn();
    for (let index = 0; index < 6; index += 1) {
      decodePixels.mockReturnValueOnce({
        data: `code-${index}`,
        location: {
          topLeftCorner: { x: index * 10, y: 2 },
          topRightCorner: { x: index * 10 + 4, y: 2 },
          bottomLeftCorner: { x: index * 10, y: 6 },
          bottomRightCorner: { x: index * 10 + 4, y: 6 },
        },
      });
    }
    const service = new ImageQrDecoderService(
      jest.fn().mockResolvedValue({
        pixels: new Uint8ClampedArray(width * height * 4),
        width,
        height,
      }),
      decodePixels,
    );

    const result = await service.decode(png);
    expect(result.candidates).toHaveLength(4);
    expect(decodePixels).toHaveBeenCalledTimes(4);
  });

  it('rejects unsafe raster dimensions with a sanitized error', async () => {
    const service = new ImageQrDecoderService(
      jest.fn().mockResolvedValue({
        pixels: new Uint8ClampedArray(4),
        width: 20_000,
        height: 20_000,
      }),
      jest.fn(),
    );

    await expect(service.decode(png)).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('sanitizes native rasterizer failures', async () => {
    const service = new ImageQrDecoderService(
      jest.fn().mockRejectedValue(new Error('native parser detail')),
      jest.fn(),
    );

    await expect(service.decode(png)).rejects.toThrow(
      'Proof image could not be decoded safely',
    );
  });
});
