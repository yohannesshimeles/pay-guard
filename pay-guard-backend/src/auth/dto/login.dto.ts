import { Type } from 'class-transformer';
import {
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class LoginContextDto {
  @IsUUID()
  membershipId!: string;

  @IsUUID()
  membershipRoleId!: string;

  @IsOptional()
  @IsUUID()
  workAssignmentId?: string;
}

export class LoginDto {
  @IsString()
  @Length(3, 254)
  identity!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsOptional()
  @IsString()
  @Length(16, 512)
  deviceIdentifier?: string;

  @IsOptional()
  @IsIn(['android', 'ios', 'web'])
  devicePlatform?: 'android' | 'ios' | 'web';

  @IsOptional()
  @ValidateNested()
  @Type(() => LoginContextDto)
  context?: LoginContextDto;
}
