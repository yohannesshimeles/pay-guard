import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ETB_AMOUNT = /^\d{1,16}\.\d{2}$/u;
const ETB_BALANCE = /^-?\d{1,16}\.\d{2}$/u;

export enum CorrectionType {
  POSITIVE = 'POSITIVE',
  NEGATIVE = 'NEGATIVE',
}

export class CreateCorrectionDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsUUID()
  settlementAccountId!: string;

  @IsEnum(CorrectionType)
  correctionType!: CorrectionType;

  @Matches(ETB_AMOUNT)
  amount!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @IsDateString({ strict: true })
  actualTransactionAt!: string;

  @IsOptional()
  @IsUUID()
  sourceReconciliationId?: string;

  @Matches(ETB_BALANCE)
  expectedCurrentBalance!: string;

  @Matches(ETB_BALANCE)
  expectedProjectedBalance!: string;
}

export class ApproveReversalDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;

  @IsDateString({ strict: true })
  actualTransactionAt!: string;

  @Matches(ETB_BALANCE)
  expectedCurrentBalance!: string;

  @Matches(ETB_BALANCE)
  expectedProjectedBalance!: string;
}

export class ListCorrectionsDto {
  @IsOptional()
  @IsUUID()
  settlementAccountId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;

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
