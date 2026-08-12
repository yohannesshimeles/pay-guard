import { Injectable } from '@nestjs/common';
import { ProofMimeType } from '../enums/proof-mime-type.enum';
import { ValidatedProofFile } from '../models/proof-file.model';
import { QrDecodeResult, QrDecoderPort } from '../ports/qr-decoder.port';
import { ImageQrDecoderService } from './image-qr-decoder.service';
import { PdfQrDecoderService } from './pdf-qr-decoder.service';

@Injectable()
export class ProofQrDecoderService implements QrDecoderPort {
  constructor(
    private readonly image: ImageQrDecoderService,
    private readonly pdf: PdfQrDecoderService,
  ) {}

  decode(file: ValidatedProofFile): Promise<QrDecodeResult> {
    return file.mimeType === ProofMimeType.PDF
      ? this.pdf.decode(file)
      : this.image.decode(file);
  }
}
