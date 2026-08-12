import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class ListFraudReviewsDto {
  @IsOptional()
  @IsIn(['OPEN', 'CLEARED'])
  status?: 'OPEN' | 'CLEARED';

  @IsOptional()
  @IsIn(['HIGH', 'CRITICAL'])
  severity?: 'HIGH' | 'CRITICAL';

  @IsOptional()
  @IsUUID()
  businessId?: string;

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

