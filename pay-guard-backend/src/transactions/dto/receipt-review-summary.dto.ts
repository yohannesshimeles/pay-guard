import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ReceiptReviewSummaryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateFrom?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dateTo?: string;
}
