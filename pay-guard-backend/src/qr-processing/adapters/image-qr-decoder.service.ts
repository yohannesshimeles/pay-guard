import { createRequire } from 'node:module';
import {
  Injectable,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ProofMimeType } from '../enums/proof-mime-type.enum';
import { ValidatedProofFile } from '../models/proof-file.model';
import {
  QrDecodeResult,
  QrDecoderPort,
} from '../ports/qr-decoder.port';

const requireModule = createRequire(__filename);
const DEFAULT_MAX_IMAGE_PIXELS = 16_000_000;
const DEFAULT_PROCESSING_TIMEOUT_SECONDS = 5;
const MAX_QR_VALUE_CHARACTERS = 4_096;
const MAX_QR_CANDIDATES = 4;

type RasterizedImage = {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
};

type Rasterizer = (
  body: Uint8Array,
  options: { maxPixels: number; timeoutSeconds: number },
) => Promise<RasterizedImage>;

type PixelQrDecoder = (
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  options: { inversionAttempts: 'dontInvert' },
) => { data: string; location?: QrLocation } | null;

type Point = { x: number; y: number };
type QrLocation = {
  topLeftCorner: Point;
  topRightCorner: Point;
  bottomLeftCorner: Point;
  bottomRightCorner: Point;
};

type SharpFactory = (
  input: Buffer,
  options: { failOn: 'error'; limitInputPixels: number; sequentialRead: true },
) => {
  rotate(): {
    ensureAlpha(): {
      raw(): {
        timeout(options: { seconds: number }): {
          toBuffer(options: { resolveWithObject: true }): Promise<{
            data: Buffer;
            info: { width: number; height: number; channels: number };
          }>;
        };
      };
    };
  };
};

function productionRasterizer(): Rasterizer {
  const sharpModule = requireModule('sharp') as
    | SharpFactory
    | { default: SharpFactory };
  const sharp =
    typeof sharpModule === 'function' ? sharpModule : sharpModule.default;

  return async (body, options) => {
    const { data, info } = await sharp(Buffer.from(body), {
      failOn: 'error',
      limitInputPixels: options.maxPixels,
      sequentialRead: true,
    })
      .rotate()
      .ensureAlpha()
      .raw()
      .timeout({ seconds: options.timeoutSeconds })
      .toBuffer({ resolveWithObject: true });

    if (info.channels !== 4) throw new Error('Unexpected pixel channel count');
    return {
      pixels: new Uint8ClampedArray(
        data.buffer,
        data.byteOffset,
        data.byteLength,
      ),
      width: info.width,
      height: info.height,
    };
  };
}

function productionDecoder(): PixelQrDecoder {
  const jsQrModule = requireModule('jsqr') as
    | PixelQrDecoder
    | { default: PixelQrDecoder };
  return typeof jsQrModule === 'function' ? jsQrModule : jsQrModule.default;
}

@Injectable()
export class ImageQrDecoderService implements QrDecoderPort {
  constructor(
    @Optional()
    private readonly rasterize: Rasterizer = productionRasterizer(),
    @Optional()
    private readonly decodePixels: PixelQrDecoder = productionDecoder(),
    @Optional()
    private readonly maxImagePixels = DEFAULT_MAX_IMAGE_PIXELS,
  ) {}

  async decode(file: ValidatedProofFile): Promise<QrDecodeResult> {
    if (file.mimeType === ProofMimeType.PDF) {
      return { supported: false, candidates: [] };
    }

    try {
      const image = await this.rasterize(file.body, {
        maxPixels: this.maxImagePixels,
        timeoutSeconds: DEFAULT_PROCESSING_TIMEOUT_SECONDS,
      });
      this.assertSafeDimensions(image);
      return {
        supported: true,
        candidates: this.decodeCandidates(image),
      };
    } catch {
      throw new UnprocessableEntityException(
        'Proof image could not be decoded safely',
      );
    }
  }

  private decodeCandidates(image: RasterizedImage): { rawValue: string }[] {
    const workingPixels = new Uint8ClampedArray(image.pixels);
    const candidates: { rawValue: string }[] = [];
    const locations = new Set<string>();

    for (let attempt = 0; attempt < MAX_QR_CANDIDATES; attempt += 1) {
      const result = this.decodePixels(
        workingPixels,
        image.width,
        image.height,
        { inversionAttempts: 'dontInvert' },
      );
      const value = result?.data.trim();
      if (!result || !value) break;
      if (value.length > MAX_QR_VALUE_CHARACTERS) {
        throw new Error('QR payload exceeds internal limit');
      }
      candidates.push({ rawValue: value });

      if (!result.location) break;
      const signature = this.locationSignature(result.location);
      if (locations.has(signature)) break;
      locations.add(signature);
      this.maskLocation(workingPixels, image, result.location);
    }
    return candidates;
  }

  private locationSignature(location: QrLocation): string {
    return [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomLeftCorner,
      location.bottomRightCorner,
    ]
      .map((point) => `${Math.round(point.x)},${Math.round(point.y)}`)
      .join('|');
  }

  private maskLocation(
    pixels: Uint8ClampedArray,
    image: Pick<RasterizedImage, 'width' | 'height'>,
    location: QrLocation,
  ): void {
    const points = [
      location.topLeftCorner,
      location.topRightCorner,
      location.bottomLeftCorner,
      location.bottomRightCorner,
    ];
    if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
      throw new Error('Invalid QR location');
    }
    const margin = 4;
    const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x))) - margin);
    const right = Math.min(
      image.width - 1,
      Math.ceil(Math.max(...points.map((point) => point.x))) + margin,
    );
    const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y))) - margin);
    const bottom = Math.min(
      image.height - 1,
      Math.ceil(Math.max(...points.map((point) => point.y))) + margin,
    );
    if (left > right || top > bottom) throw new Error('Invalid QR bounds');

    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const offset = (y * image.width + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = 255;
      }
    }
  }

  private assertSafeDimensions(image: RasterizedImage): void {
    if (
      image.width < 1 ||
      image.height < 1 ||
      image.width * image.height > this.maxImagePixels ||
      image.pixels.length !== image.width * image.height * 4
    ) {
      throw new Error('Unsafe raster dimensions');
    }
  }
}
