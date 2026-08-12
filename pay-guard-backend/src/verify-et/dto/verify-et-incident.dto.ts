import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class ListVerifyEtIncidentsDto {
  @IsOptional()
  @IsIn(['HIGH', 'CRITICAL'])
  severity?: 'HIGH' | 'CRITICAL';

  @IsOptional()
  @IsIn(['OPEN', 'ACKNOWLEDGED'])
  status?: 'OPEN' | 'ACKNOWLEDGED';

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

export class AcknowledgeVerifyEtIncidentDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
