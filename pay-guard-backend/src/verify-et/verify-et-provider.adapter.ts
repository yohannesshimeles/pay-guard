import { Injectable } from '@nestjs/common';

export const VERIFYET_PROVIDER_ADAPTER = Symbol('VERIFYET_PROVIDER_ADAPTER');

export type VerifyEtProviderRequest = Readonly<{
  idempotencyKey: string;
  verificationAttemptId: string;
  bankCode: string;
  transactionReference: string;
  amount: string;
  receiverAccountSuffix: string;
}>;

type ProviderResultBase = Readonly<{
  httpStatus: number;
  providerRequestId: string;
  providerStatus: string;
  requestedAt: Date;
  respondedAt: Date;
}>;

export type VerifyEtProviderResult =
  | (ProviderResultBase &
      Readonly<{
        result: 'PENDING';
        nextRecheckAt: Date;
      }>)
  | (ProviderResultBase &
      Readonly<{
        result: 'FAILED';
        errorCode?: string;
      }>)
  | (ProviderResultBase &
      Readonly<{
        result: 'VERIFIED';
        providerBankId: string;
        transactionReference: string;
        amount: string;
        receiverAccountSuffix: string;
        providerTransactionAt: Date;
      }>);

export interface VerifyEtProviderAdapter {
  verify(request: VerifyEtProviderRequest): Promise<VerifyEtProviderResult>;
}

@Injectable()
export class UnconfiguredVerifyEtProviderAdapter implements VerifyEtProviderAdapter {
  verify(): Promise<VerifyEtProviderResult> {
    throw new Error('Verify.ET provider transport is not configured');
  }
}
