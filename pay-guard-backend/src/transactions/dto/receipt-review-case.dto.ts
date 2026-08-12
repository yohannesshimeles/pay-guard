import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ReceiptReviewReasonCode } from '../../qr-processing/receipt-match-decision.dao';

const reviewReasons: ReceiptReviewReasonCode[] = [
  'NO_QR', 'MULTIPLE_QR', 'UNSUPPORTED_PROOF', 'INCOMPLETE_QR',
  'UNSUPPORTED_BANK', 'BANK_MISMATCH', 'REFERENCE_MISMATCH',
  'AMOUNT_MISMATCH', 'DATE_MISMATCH', 'TIME_MISMATCH', 'ACCOUNT_MISMATCH',
];

export class ListReceiptReviewCasesDto {
  @IsOptional()
  @IsIn(['OPEN', 'ACKNOWLEDGED', 'RESOLVED'])
  status?: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';

  @IsOptional()
  @IsIn(reviewReasons)
  reasonCode?: ReceiptReviewReasonCode;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10_000)
  offset = 0;
}

export class ReceiptReviewAgeingSummaryDto {
  @IsOptional()
  @IsIn(reviewReasons)
  reasonCode?: ReceiptReviewReasonCode;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(720)
  slaHours = 24;
}

export class AcknowledgeReceiptReviewCaseDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  note!: string;
}

export class ResolveReceiptReviewCaseDto {
  @IsIn([
    'EVIDENCE_REPLACED', 'FALSE_POSITIVE', 'INVALID_RECEIPT',
    'DUPLICATE_RECEIPT', 'OTHER',
  ])
  resolutionCode!:
    | 'EVIDENCE_REPLACED'
    | 'FALSE_POSITIVE'
    | 'INVALID_RECEIPT'
    | 'DUPLICATE_RECEIPT'
    | 'OTHER';

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
