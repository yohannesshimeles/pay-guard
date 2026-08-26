import { createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { VerifyEtCredentialService } from './verify-et-credential.service';

export const VERIFYET_WEBHOOK_SIGNATURE_VERIFIER = Symbol(
  'VERIFYET_WEBHOOK_SIGNATURE_VERIFIER',
);

export type VerifyEtWebhookHeaders = Readonly<
  Record<string, string | string[] | undefined>
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

export class VerifyEtWebhookSignatureInvalidError extends Error {
  readonly name = 'VerifyEtWebhookSignatureInvalidError';

  constructor() {
    super('Verify.ET webhook signature is invalid');
  }
}

@Injectable()
export class HmacVerifyEtWebhookSignatureVerifier implements VerifyEtWebhookSignatureVerifier {
  constructor(private readonly credentials: VerifyEtCredentialService) {}

  verify(input: {
    rawBody: Uint8Array;
    headers: VerifyEtWebhookHeaders;
  }): Promise<VerifiedVerifyEtWebhook> {
    const { webhookSecret } = this.credentials.getEnabledConfig();
    if (!webhookSecret) {
      return Promise.reject(new VerifyEtWebhookSignatureUnavailableError());
    }
    const timestamp = header(input.headers, 'x-webhook-timestamp');
    const signature = header(input.headers, 'x-webhook-signature');
    const deliveryId = header(input.headers, 'x-webhook-delivery-id');
    const eventType = header(input.headers, 'x-webhook-event');
    if (!timestamp || !signature || !deliveryId || !eventType) {
      return Promise.reject(new VerifyEtWebhookSignatureInvalidError());
    }
    const digest = createHmac('sha256', webhookSecret)
      .update(`${timestamp}.`, 'utf8')
      .update(input.rawBody)
      .digest('hex');
    const expected = Buffer.from(`sha256=${digest}`, 'utf8');
    const received = Buffer.from(signature, 'utf8');
    if (
      received.byteLength !== expected.byteLength ||
      !timingSafeEqual(received, expected)
    ) {
      return Promise.reject(new VerifyEtWebhookSignatureInvalidError());
    }
    return Promise.resolve({ deliveryId, eventType });
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

function header(
  headers: VerifyEtWebhookHeaders,
  expectedName: string,
): string | undefined {
  const entry = Object.entries(headers).find(
    ([name]) => name.toLowerCase() === expectedName,
  )?.[1];
  const value = Array.isArray(entry) ? entry[0] : entry;
  return typeof value === 'string' && value.length > 0 && value.length <= 512
    ? value
    : undefined;
}
