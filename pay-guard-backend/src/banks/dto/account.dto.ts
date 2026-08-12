import {
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
} from 'class-validator';

export class CreateSettlementAccountDto {
  @IsUUID()
  bankId!: string;

  @IsString()
  @MinLength(4)
  accountValue!: string;

  @IsOptional()
  @IsString()
  label?: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  accountName?: string;

  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  openingBalance?: number;

  @IsOptional()
  @IsDateString()
  openingBalanceDate?: string;
}

export class CreatePlatformAccountDto extends CreateSettlementAccountDto {
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(['STARTER', 'PROFESSIONAL', 'BUSINESS'], { each: true })
  acceptedPlanCodes?: string[];

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;
}

export class UpdateBankDto {
  @IsBoolean()
  enabled!: boolean;
}

export class CreateBankDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  shortName?: string;

  @IsOptional()
  @IsIn(['BANK_ACCOUNT', 'WALLET'])
  accountType?: 'BANK_ACCOUNT' | 'WALLET';

  @IsOptional()
  @IsIn(['REFERENCE', 'URL_TOKEN', 'TRANSACTION_NO'])
  verificationMethod?: 'REFERENCE' | 'URL_TOKEN' | 'TRANSACTION_NO';

  @IsOptional()
  @IsString()
  verifyetBankIdentifier?: string;

  @IsOptional()
  @IsString()
  accountNumberPattern?: string;

  @IsOptional()
  @IsString()
  phoneNumberFormat?: string;
}

export class UpdatePlatformAccountDto {
  @IsOptional()
  @IsBoolean()
  active?: boolean;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @IsIn(['STARTER', 'PROFESSIONAL', 'BUSINESS'], { each: true })
  acceptedPlanCodes?: string[];
}
