import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateBranchDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsString()
  timezone?: string;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  subCity?: string;

  @IsOptional()
  @IsString()
  woreda?: string;

  @IsOptional()
  @IsString()
  locationDetails?: string;

  @IsOptional()
  @IsIn(['MAIN_BUSINESS_ALL', 'BRANCH_SPECIFIC'])
  settlementMode?: 'MAIN_BUSINESS_ALL' | 'BRANCH_SPECIFIC';
}

export class UpdateBranchDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsString()
  address?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1440)
  verificationTimeToleranceMinutes?: number;

  @IsOptional()
  @IsString()
  city?: string;

  @IsOptional()
  @IsString()
  subCity?: string;

  @IsOptional()
  @IsString()
  woreda?: string;

  @IsOptional()
  @IsString()
  locationDetails?: string;

  @IsOptional()
  @IsIn(['MAIN_BUSINESS_ALL', 'BRANCH_SPECIFIC'])
  settlementMode?: 'MAIN_BUSINESS_ALL' | 'BRANCH_SPECIFIC';
}
