import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { hashVerifyEtBytes } from './verify-et-payload-hash';

export type VerifyEtWebhookDeliveryStatus =
  'RECEIVED' | 'PROCESSING' | 'PROCESSED' | 'FAILED';

type DeliveryRow = {
  id: string;
  delivery_id: string;
  event_type: string;
  payload_hash: string;
  delivery_status: VerifyEtWebhookDeliveryStatus;
  processing_attempts: number;
  last_error_code: string | null;
  signature_verified_at: Date;
  first_received_at: Date;
  processing_started_at: Date | null;
  processed_at: Date | null;
  updated_at: Date;
};

export type VerifyEtWebhookDelivery = {
  id: string;
  deliveryId: string;
  eventType: string;
  payloadHash: string;
  status: VerifyEtWebhookDeliveryStatus;
  processingAttempts: number;
  lastErrorCode?: string;
  signatureVerifiedAt: Date;
  firstReceivedAt: Date;
  processingStartedAt?: Date;
  processedAt?: Date;
  updatedAt: Date;
};

export class VerifyEtWebhookDeliveryConflictError extends Error {
  readonly name = 'VerifyEtWebhookDeliveryConflictError';

  constructor() {
    super('Verify.ET webhook delivery identifier conflicts with prior content');
  }
}

@Injectable()
export class VerifyEtWebhookDeliveryDao {
  constructor(private readonly dao: CentralDao) {}

  reserveVerified(input: {
    deliveryId: string;
    eventType: string;
    rawBody: Uint8Array;
    maxPayloadBytes: number;
  }): Promise<{ delivery: VerifyEtWebhookDelivery; duplicate: boolean }> {
    this.validateDeliveryId(input.deliveryId);
    this.validateEventType(input.eventType);
    const payloadHash = hashVerifyEtBytes(input.rawBody, input.maxPayloadBytes);

    return this.dao.transaction(async (transaction) => {
      const inserted = await transaction.optional<DeliveryRow>(
        `INSERT INTO verifyet_webhook_deliveries (
           delivery_id, event_type, payload_hash
         ) VALUES ($1, $2, $3)
         ON CONFLICT (delivery_id) DO NOTHING
         RETURNING *`,
        [input.deliveryId, input.eventType, payloadHash],
      );
      if (inserted) {
        return { delivery: this.map(inserted), duplicate: false };
      }

      const existing = await transaction.one<DeliveryRow>(
        `SELECT * FROM verifyet_webhook_deliveries
         WHERE delivery_id = $1
         FOR UPDATE`,
        [input.deliveryId],
      );
      if (
        existing.event_type !== input.eventType ||
        existing.payload_hash !== payloadHash
      ) {
        throw new VerifyEtWebhookDeliveryConflictError();
      }
      return { delivery: this.map(existing), duplicate: true };
    });
  }

  async claim(
    deliveryRecordId: string,
  ): Promise<VerifyEtWebhookDelivery | undefined> {
    const row = await this.dao.optional<DeliveryRow>(
      `UPDATE verifyet_webhook_deliveries
       SET delivery_status = 'PROCESSING',
           processing_attempts = processing_attempts + 1,
           processing_started_at = now(),
           last_error_code = NULL,
           updated_at = now()
       WHERE id = $1
         AND delivery_status IN ('RECEIVED','FAILED')
       RETURNING *`,
      [deliveryRecordId],
    );
    return row ? this.map(row) : undefined;
  }

  async finish(
    deliveryRecordId: string,
    result: { succeeded: boolean; errorCode?: string },
  ): Promise<VerifyEtWebhookDelivery> {
    if (result.succeeded && result.errorCode) {
      throw new Error('Successful Verify.ET webhook cannot have an error code');
    }
    if (!result.succeeded && !result.errorCode) {
      throw new Error('Failed Verify.ET webhook requires an error code');
    }
    if (result.errorCode && !/^[A-Z0-9_]{1,80}$/u.test(result.errorCode)) {
      throw new Error('Verify.ET webhook error code is invalid');
    }

    const row = await this.dao.one<DeliveryRow>(
      `UPDATE verifyet_webhook_deliveries
       SET delivery_status = $2,
           last_error_code = $3,
           processed_at = CASE WHEN $2 = 'PROCESSED' THEN now() ELSE NULL END,
           updated_at = now()
       WHERE id = $1
         AND delivery_status = 'PROCESSING'
       RETURNING *`,
      [
        deliveryRecordId,
        result.succeeded ? 'PROCESSED' : 'FAILED',
        result.errorCode ?? null,
      ],
    );
    return this.map(row);
  }

  private validateDeliveryId(value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(value)) {
      throw new Error('Verify.ET webhook delivery identifier is invalid');
    }
  }

  private validateEventType(value: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/u.test(value)) {
      throw new Error('Verify.ET webhook event type is invalid');
    }
  }

  private map(row: DeliveryRow): VerifyEtWebhookDelivery {
    return {
      id: row.id,
      deliveryId: row.delivery_id,
      eventType: row.event_type,
      payloadHash: row.payload_hash,
      status: row.delivery_status,
      processingAttempts: row.processing_attempts,
      lastErrorCode: row.last_error_code ?? undefined,
      signatureVerifiedAt: row.signature_verified_at,
      firstReceivedAt: row.first_received_at,
      processingStartedAt: row.processing_started_at ?? undefined,
      processedAt: row.processed_at ?? undefined,
      updatedAt: row.updated_at,
    };
  }
}
