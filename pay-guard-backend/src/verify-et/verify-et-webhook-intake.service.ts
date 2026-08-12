import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import {
  VerifyEtWebhookDelivery,
  VerifyEtWebhookDeliveryDao,
} from './verify-et-webhook-delivery.dao';
import {
  VERIFYET_WEBHOOK_SIGNATURE_VERIFIER,
  VerifyEtWebhookHeaders,
  VerifyEtWebhookSignatureUnavailableError,
  VerifyEtWebhookSignatureVerifier,
} from './verify-et-webhook-signature-verifier';

@Injectable()
export class VerifyEtWebhookIntakeService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(VERIFYET_WEBHOOK_SIGNATURE_VERIFIER)
    private readonly verifier: VerifyEtWebhookSignatureVerifier,
    private readonly deliveries: VerifyEtWebhookDeliveryDao,
  ) {}

  async accept(
    rawBody: Uint8Array,
    headers: VerifyEtWebhookHeaders,
  ): Promise<{ delivery: VerifyEtWebhookDelivery; duplicate: boolean }> {
    if (!this.config.verifyEt.enabled) {
      throw new VerifyEtWebhookSignatureUnavailableError();
    }
    if (rawBody.byteLength === 0) {
      throw new Error('Verify.ET webhook body is empty');
    }
    if (rawBody.byteLength > this.config.verifyEt.maxResponseBytes) {
      throw new Error('Verify.ET webhook body exceeds the configured limit');
    }

    const verified = await this.verifier.verify({ rawBody, headers });
    return this.deliveries.reserveVerified({
      ...verified,
      rawBody,
      maxPayloadBytes: this.config.verifyEt.maxResponseBytes,
    });
  }
}
