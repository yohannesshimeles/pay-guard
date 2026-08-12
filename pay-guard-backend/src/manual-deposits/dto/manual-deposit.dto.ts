import { Type } from 'class-transformer';
import {
  IsDateString,
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

export class CreateManualDepositDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsUUID()
  settlementAccountId!: string;

  @Matches(ETB_AMOUNT)
  amount!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(500)
  description!: string;

  @IsDateString({ strict: true })
  actualTransactionAt!: string;

  @Matches(ETB_BALANCE)
  expectedCurrentBalance!: string;

  @Matches(ETB_BALANCE)
  expectedProjectedBalance!: string;
}

export class ListManualDepositsDto {
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
