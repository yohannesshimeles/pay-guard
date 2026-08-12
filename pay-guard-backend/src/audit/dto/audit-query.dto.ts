import { Type } from 'class-transformer';
import {
  IsDateString, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';

export class AuditQueryDto {
  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  businessId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[A-Z0-9_]+$/u)
  actionType?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  @Matches(/^[A-Z0-9_]+$/u)
  recordType?: string;

  @IsOptional()
  @IsIn(['SUCCESS', 'FAILURE'])
  result?: 'SUCCESS' | 'FAILURE';

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
