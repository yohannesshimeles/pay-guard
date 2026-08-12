import {
  BadRequestException,
  Controller,
  Inject,
  Param,
  ParseUUIDPipe,
  PayloadTooLargeException,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { DEFAULT_MAX_PROOF_BYTES } from './proof-file.validator';
import { ProofIntakeService } from './proof-intake.service';
import { TransactionReceiptAccessDao } from './transaction-receipt-access.dao';
import { VerificationPreparationService } from '../verifications/verification-preparation.service';
import { VerificationAttemptType } from '../verifications/enums/verification-attempt-type.enum';
import { QrExtractionState } from './enums/qr-extraction-state.enum';
import { ReceiptTransactionMatcherService } from './receipt-transaction-matcher.service';
import {
  ReceiptMatchDecisionDao,
  ReceiptMatchDecisionInput,
  ReceiptReviewReasonCode,
} from './receipt-match-decision.dao';

type MultipartPart = {
  fieldname: string;
  filename: string;
  mimetype: string;
  toBuffer(): Promise<Buffer>;
};

type MultipartRequest = {
  file(options: {
    limits: { fileSize: number; files: number; fields: number; parts: number };
  }): Promise<MultipartPart | undefined>;
};

@ApiTags('Transaction Receipts')
@ApiBearerAuth()
@UseGuards(AuthGuard, RolesGuard)
@Controller('transactions/:transactionId/receipts')
export class ProofUploadController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly access: TransactionReceiptAccessDao,
    private readonly intake: ProofIntakeService,
    private readonly verifications: VerificationPreparationService,
    private readonly matcher: ReceiptTransactionMatcherService,
    private readonly matchDecisions: ReceiptMatchDecisionDao,
  ) {}

  @Post()
  @ApiConsumes('multipart/form-data')
  @Roles(
    'BUSINESS_OWNER',
    'PRIMARY_OWNER',
    'ADDITIONAL_OWNER',
    'MANAGER',
    'CASHIER',
    'WAITER',
  )
  async upload(
    @Param('transactionId', new ParseUUIDPipe()) transactionId: string,
    @Req() request: MultipartRequest,
    @CurrentUser() principal: AuthenticatedPrincipal,
  ) {
    if (this.config.databaseSchemaVersion !== 'v2') {
      throw new ServiceUnavailableException(
        'Transaction receipt intake requires the V2 database schema',
      );
    }
    const scope = await this.access.assertCanUpload(transactionId, principal);

    const part = await this.readProofPart(request);
    const inspected = await this.intake.inspect({
      fileName: part.filename,
      mimeType: part.mimetype,
      body: await this.readBody(part),
    });
    const receipt = await this.intake.persistReceipt(
      transactionId,
      principal.userId,
      inspected,
    );
    const candidate = inspected.extraction.candidates[0];
    const receiptMatch = this.receiptMatch(inspected, scope);
    await this.matchDecisions.record({
      receiptId: receipt.id,
      transactionId,
      ...receiptMatch,
    });
    const verification =
      inspected.extraction.state === QrExtractionState.SINGLE_QR &&
      candidate?.parsed?.status === 'COMPLETE' &&
      candidate.parsed.directVerificationSupported &&
      receiptMatch.decision === 'MATCHED'
        ? await this.verifications.prepare({
            transactionId,
            businessId: scope.businessId,
            branchId: scope.branchId,
            attemptType: VerificationAttemptType.INITIAL,
            attemptKey: `verification:initial:${transactionId}`,
          })
        : {
            decision: 'REVIEW_REQUIRED' as const,
            ...(receiptMatch.decision === 'REVIEW_REQUIRED'
              ? { reasonCode: receiptMatch.reasonCode }
              : {}),
          };

    return {
      receipt: receipt.toPublicModel(),
      extraction: {
        state: inspected.extraction.state,
        candidateCount: inspected.extraction.candidates.length,
      },
      verification,
    };
  }

  private receiptMatch(
    inspected: Awaited<ReturnType<ProofIntakeService['inspect']>>,
    scope: Awaited<ReturnType<TransactionReceiptAccessDao['assertCanUpload']>>,
  ): Omit<ReceiptMatchDecisionInput, 'receiptId' | 'transactionId'> {
    if (inspected.extraction.state !== QrExtractionState.SINGLE_QR) {
      const reasonByState: Record<string, ReceiptReviewReasonCode> = {
        [QrExtractionState.NO_QR]: 'NO_QR',
        [QrExtractionState.MULTIPLE_QR]: 'MULTIPLE_QR',
        [QrExtractionState.UNSUPPORTED_PROOF]: 'UNSUPPORTED_PROOF',
      };
      return {
        decision: 'REVIEW_REQUIRED',
        reasonCode: reasonByState[inspected.extraction.state],
      };
    }
    const parsed = inspected.extraction.candidates[0]?.parsed;
    if (parsed?.status === 'UNSUPPORTED_BANK') {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'UNSUPPORTED_BANK' };
    }
    if (parsed?.status !== 'COMPLETE' || !parsed.directVerificationSupported) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'INCOMPLETE_QR' };
    }
    return this.matcher.match(scope, parsed);
  }

  private async readProofPart(request: MultipartRequest): Promise<MultipartPart> {
    try {
      const part = await request.file({
        limits: {
          fileSize: DEFAULT_MAX_PROOF_BYTES,
          files: 1,
          fields: 0,
          parts: 1,
        },
      });
      if (!part) throw new BadRequestException('A proof file is required');
      if (part.fieldname !== 'proof') {
        throw new BadRequestException('The file field must be named proof');
      }
      return part;
    } catch (error) {
      this.rethrowMultipartError(error);
    }
  }

  private async readBody(part: MultipartPart): Promise<Buffer> {
    try {
      return await part.toBuffer();
    } catch (error) {
      this.rethrowMultipartError(error);
    }
  }

  private rethrowMultipartError(error: unknown): never {
    if (error instanceof BadRequestException) throw error;
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      Number(error.statusCode) === 413
    ) {
      throw new PayloadTooLargeException('Proof file exceeds the size limit');
    }
    throw new BadRequestException('Invalid multipart proof upload');
  }
}
