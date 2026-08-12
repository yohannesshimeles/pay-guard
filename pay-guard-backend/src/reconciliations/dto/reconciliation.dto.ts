import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

const ETB_BALANCE = /^-?\d{1,16}\.\d{2}$/u;

export class CreateReconciliationDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsUUID()
  settlementAccountId!: string;

  @IsDateString({ strict: true })
  reconciliationDate!: string;

  @Matches(ETB_BALANCE)
  actualBankBalance!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  description!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  differenceExplanation?: string;
}

export class ListReconciliationsDto {
  @IsOptional()
  @IsIn(['DRAFT', 'SUBMITTED', 'MATCHED', 'DISCREPANCY', 'APPROVED', 'RETURNED', 'SUPERSEDED', 'ARCHIVED'])
  status?: string;

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

export class DecideReconciliationDto {
  @IsIn(['APPROVED', 'RETURNED'])
  decision!: 'APPROVED' | 'RETURNED';

  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  reason!: string;
}
