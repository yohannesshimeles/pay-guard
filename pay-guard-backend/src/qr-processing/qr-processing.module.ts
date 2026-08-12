import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClamAvMalwareScannerService } from './adapters/clamav-malware-scanner.service';
import { ImageQrDecoderService } from './adapters/image-qr-decoder.service';
import { PdfQrDecoderService } from './adapters/pdf-qr-decoder.service';
import { ProofQrDecoderService } from './adapters/proof-qr-decoder.service';
import { MALWARE_SCANNER } from './ports/malware-scanner.port';
import { QR_DECODER } from './ports/qr-decoder.port';
import {
  DEFAULT_MAX_PROOF_BYTES,
  MAX_PROOF_BYTES,
  ProofFileValidator,
} from './proof-file.validator';
import { ProofIntakeService } from './proof-intake.service';
import { ProofUploadController } from './proof-upload.controller';
import { TransactionReceiptAccessDao } from './transaction-receipt-access.dao';
import { TransactionReceiptDao } from './transaction-receipt.dao';
import { QrPayloadParserService } from './qr-payload-parser.service';
import { PdfQrWorkerClient } from './pdf-qr-worker.client';
import { VerificationsModule } from '../verifications/verifications.module';
import { ReceiptTransactionMatcherService } from './receipt-transaction-matcher.service';
import { ReceiptMatchDecisionDao } from './receipt-match-decision.dao';

@Module({
  imports: [AuthModule, VerificationsModule],
  controllers: [ProofUploadController],
  providers: [
    { provide: MAX_PROOF_BYTES, useValue: DEFAULT_MAX_PROOF_BYTES },
    ProofFileValidator,
    QrPayloadParserService,
    ClamAvMalwareScannerService,
    ImageQrDecoderService,
    PdfQrWorkerClient,
    PdfQrDecoderService,
    ProofQrDecoderService,
    TransactionReceiptDao,
    TransactionReceiptAccessDao,
    ProofIntakeService,
    ReceiptTransactionMatcherService,
    ReceiptMatchDecisionDao,
    {
      provide: MALWARE_SCANNER,
      useExisting: ClamAvMalwareScannerService,
    },
    { provide: QR_DECODER, useExisting: ProofQrDecoderService },
  ],
  exports: [ProofFileValidator, MALWARE_SCANNER, ProofIntakeService],
})
export class QrProcessingModule {}
