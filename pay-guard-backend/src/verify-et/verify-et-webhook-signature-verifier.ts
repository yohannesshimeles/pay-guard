import { Injectable } from '@nestjs/common';

export const VERIFYET_WEBHOOK_SIGNATURE_VERIFIER = Symbol(
  'VERIFYET_WEBHOOK_SIGNATURE_VERIFIER',
);

export type VerifyEtWebhookHeaders = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export type VerifiedVerifyEtWebhook = Readonly<{
  deliveryId: string;
  eventType: string;
}>;

export interface VerifyEtWebhookSignatureVerifier {
  verify(input: {
    rawBody: Uint8Array;
    headers: VerifyEtWebhookHeaders;
  }): Promise<VerifiedVerifyEtWebhook>;
}

export class VerifyEtWebhookSignatureUnavailableError extends Error {
  readonly name = 'VerifyEtWebhookSignatureUnavailableError';

  constructor() {
    super('Verify.ET webhook signature verification is unavailable');
  }
}

@Injectable()
export class UnconfiguredVerifyEtWebhookSignatureVerifier implements VerifyEtWebhookSignatureVerifier {
  verify(input: {
    rawBody: Uint8Array;
    headers: VerifyEtWebhookHeaders;
  }): Promise<never> {
    void input;
    return Promise.reject(new VerifyEtWebhookSignatureUnavailableError());
  }
}
