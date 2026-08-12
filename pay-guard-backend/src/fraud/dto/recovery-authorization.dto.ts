import { Type } from 'class-transformer';
import {
  IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength,
} from 'class-validator';

export class IssueRecoveryAuthorizationDto {
  @IsUUID()
  requestKey!: string;

  @IsUUID()
  deliveredToUserId!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reviewNote!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(5)
  @Max(60)
  expiresInMinutes = 15;
}

export class RevokeRecoveryAuthorizationDto {
  @IsString()
  @MinLength(10)
  @MaxLength(500)
  reason!: string;
}

export class RedeemRecoveryAuthorizationDto {
  @IsString()
  @MinLength(20)
  @MaxLength(80)
  authorizationCode!: string;
}

