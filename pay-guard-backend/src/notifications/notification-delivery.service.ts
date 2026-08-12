import { Inject, Injectable } from '@nestjs/common';
import { NotificationDeliveryDao } from './notification-delivery.dao';
import { NotificationTokenCryptoService } from './notification-token-crypto.service';
import {
  PUSH_NOTIFICATION_PORT, PushNotificationPort, PushProviderError,
  PushProviderNotConfiguredError,
} from './push-notification.port';

export type NotificationDeliveryResult =
  | { status: 'IDLE' }
  | { status: 'DELIVERED'; notificationId: string }
  | { status: 'DEFERRED' | 'FAILED'; notificationId: string; errorCode: string };

@Injectable()
export class NotificationDeliveryService {
  constructor(
    private readonly deliveries: NotificationDeliveryDao,
    private readonly crypto: NotificationTokenCryptoService,
    @Inject(PUSH_NOTIFICATION_PORT) private readonly push: PushNotificationPort,
  ) {}

  async processNext(now = new Date()): Promise<NotificationDeliveryResult> {
    const claim = await this.deliveries.claimNext();
    if (!claim) return { status: 'IDLE' };
    try {
      const recipientToken = this.crypto.decrypt({
        ciphertext: claim.tokenCiphertext,
        iv: claim.tokenIv,
        authTag: claim.tokenAuthTag,
      });
      const sent = await this.push.send({
        recipientToken, title: claim.title, message: claim.message,
        data: { notificationId: claim.notificationId },
      });
      await this.deliveries.complete(claim, sent.providerMessageId);
      return { status: 'DELIVERED', notificationId: claim.notificationId };
    } catch (error) {
      const failure = classifyFailure(error);
      const retryAt = failure.retryable
        ? new Date(now.getTime() + retryDelayMs(claim.attemptNo)) : undefined;
      await this.deliveries.fail(claim, failure.code, failure.retryable, retryAt);
      return {
        status: failure.retryable && claim.attemptNo < 3 ? 'DEFERRED' : 'FAILED',
        notificationId: claim.notificationId, errorCode: failure.code,
      };
    }
  }
}

function classifyFailure(error: unknown) {
  if (error instanceof PushProviderError) {
    return { code: error.code, retryable: error.retryable };
  }
  if (error instanceof PushProviderNotConfiguredError) {
    return { code: 'PUSH_PROVIDER_NOT_CONFIGURED', retryable: false };
  }
  return { code: 'PUSH_DELIVERY_INTERNAL_ERROR', retryable: true };
}

export function retryDelayMs(attemptNo: number): number {
  return attemptNo <= 1 ? 30_000 : 300_000;
}

