import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateSubscriptionPurchaseDto {
  @IsUUID()
  idempotencyKey!: string;

  @IsUUID()
  planId!: string;

  @IsUUID()
  paymentBankId!: string;
}

export class ListSubscriptionPurchasesDto {
  @IsOptional()
  @IsIn([
    'ORDER_CREATED', 'PROOF_RECEIVED', 'VERIFICATION_PENDING', 'VERIFIED',
    'FAILED', 'DUPLICATE', 'CANCELLED',
  ])
  status?: string;

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
