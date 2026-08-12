import { IsDateString, IsOptional, IsUUID } from 'class-validator';

class DateRangeQueryDto {
  @IsDateString({ strict: true })
  dateFrom!: string;

  @IsDateString({ strict: true })
  dateTo!: string;
}

export class FinancialSummaryQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  settlementAccountId?: string;

}

export class OperationalSummaryQueryDto extends DateRangeQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

export class ProviderSummaryQueryDto extends DateRangeQueryDto {}
