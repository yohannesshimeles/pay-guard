import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  OBJECT_STORAGE,
  ObjectStoragePort,
} from '../storage/object-storage.port';
import { MalwareScanStatus } from './enums/malware-scan-status.enum';
import { ProofMimeType } from './enums/proof-mime-type.enum';
import { QrExtractionState } from './enums/qr-extraction-state.enum';
import { InspectedProofModel } from './models/inspected-proof.model';
import { ProofFileInput, StoredProofModel } from './models/proof-file.model';
import { createQrExtraction } from './models/qr-extraction.model';
import {
  MALWARE_SCANNER,
  MalwareScannerPort,
} from './ports/malware-scanner.port';
import { QR_DECODER, QrDecoderPort } from './ports/qr-decoder.port';
import { ProofFileValidator } from './proof-file.validator';
import { TransactionReceiptDao } from './transaction-receipt.dao';
import { QrPayloadParserService } from './qr-payload-parser.service';
import { V2SelectedAuthContext } from '../auth/v2-auth.types';

const extensionByMimeType: Record<ProofMimeType, string> = {
  [ProofMimeType.JPEG]: 'jpg',
  [ProofMimeType.PNG]: 'png',
  [ProofMimeType.PDF]: 'pdf',
};

@Injectable()
export class ProofIntakeService {
  private readonly logger = new Logger(ProofIntakeService.name);

  constructor(
    private readonly validator: ProofFileValidator,
    @Inject(MALWARE_SCANNER) private readonly malware: MalwareScannerPort,
    @Inject(QR_DECODER) private readonly decoder: QrDecoderPort,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStoragePort,
    private readonly receipts: TransactionReceiptDao,
    private readonly payloadParser: QrPayloadParserService =
      new QrPayloadParserService(),
  ) {}

  async inspect(input: ProofFileInput): Promise<InspectedProofModel> {
    const file = this.validator.validate(input);
    const scan = await this.malware.scan(file);
    if (scan.status === MalwareScanStatus.INFECTED) {
      throw new UnprocessableEntityException(
        'Proof file failed security validation',
      );
    }
    if (scan.status !== MalwareScanStatus.CLEAN) {
      throw new ServiceUnavailableException(
        'Proof security scan is unavailable',
      );
    }

    const decoded = await this.decoder.decode(file);
    const candidates = decoded.supported
      ? decoded.candidates.map((candidate) => ({
          ...candidate,
          parsed: this.payloadParser.parse(candidate.rawValue),
        }))
      : [];
    return {
      file,
      extraction: decoded.supported
        ? createQrExtraction(candidates)
        : {
            state: QrExtractionState.UNSUPPORTED_PROOF,
            candidates: [],
          },
    };
  }

  async persistReceipt(
    transactionId: string,
    submittedByUserId: string,
    inspected: InspectedProofModel,
    audit?: {
      actor: V2SelectedAuthContext;
      sessionId: string;
      businessId: string;
      branchId: string;
    },
  ) {
    const objectKey = this.privateObjectKey(inspected.file.mimeType);
    await this.storage.putObject(
      objectKey,
      inspected.file.body,
      inspected.file.mimeType,
    );

    const proof: StoredProofModel = {
      objectKey,
      fileName: inspected.file.fileName,
      mimeType: inspected.file.mimeType,
      sizeBytes: inspected.file.sizeBytes,
      sha256: inspected.file.sha256,
    };
    try {
      return await this.receipts.create({
        transactionId,
        submittedByUserId,
        proof,
        audit,
      });
    } catch (error) {
      await this.storage.deleteObject(objectKey).catch(() => {
        this.logger.warn(
          JSON.stringify({ event: 'proof_storage_compensation_failed' }),
        );
      });
      throw error;
    }
  }

  private privateObjectKey(mimeType: ProofMimeType): string {
    return `private/transaction-receipts/${randomUUID()}.${extensionByMimeType[mimeType]}`;
  }
}
