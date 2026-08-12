import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';

export class CreateTransactionDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsUUID()
  settlementAccountId!: string;

  @IsUUID()
  bankId!: string;

  @IsString()
  @Matches(/^[A-Za-z0-9._/-]{4,180}$/u)
  transactionReference!: string;

  @IsString()
  @Matches(/^\d{1,15}(?:\.\d{1,2})?$/u)
  amount!: string;

  @IsDateString({ strict: true })
  transactionDate!: string;

  @IsString()
  @Matches(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/u)
  transactionTime!: string;

  @IsIn(['QR_SCAN', 'DOCUMENT_SCAN', 'MANUAL'])
  submissionMethod!: 'QR_SCAN' | 'DOCUMENT_SCAN' | 'MANUAL';

  @IsOptional()
  @IsString()
  @MaxLength(220)
  senderName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(220)
  receiverName?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\*{2,20}[A-Za-z0-9]{2,12}$/u)
  maskedReceiverAccount?: string;
}
