import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class BusinessStatusDto {
  @IsIn(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED'])
  status!: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MinLength(3)
  reason?: string;
}
