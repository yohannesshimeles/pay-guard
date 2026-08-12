import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

export enum ReportExportType {
  FINANCIAL_SUMMARY = 'FINANCIAL_SUMMARY',
  OPERATIONAL_SUMMARY = 'OPERATIONAL_SUMMARY',
}

export class CreateReportExportDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsEnum(ReportExportType)
  reportType!: ReportExportType;

  @IsDateString({ strict: true })
  dateFrom!: string;

  @IsDateString({ strict: true })
  dateTo!: string;

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  settlementAccountId?: string;
}
