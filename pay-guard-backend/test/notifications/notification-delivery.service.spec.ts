import { NotificationDeliveryDao, NotificationDeliveryClaim } from '../../src/notifications/notification-delivery.dao';
import { NotificationDeliveryService, retryDelayMs } from '../../src/notifications/notification-delivery.service';
import { NotificationTokenCryptoService } from '../../src/notifications/notification-token-crypto.service';
import { PushProviderError } from '../../src/notifications/push-notification.port';

describe('NotificationDeliveryService', () => {
  const claim: NotificationDeliveryClaim = {
    notificationId: 'notification-id', deviceId: 'device-id', attemptNo: 1,
    claimToken: 'claim-token', title: 'Alert', message: 'Review required',
    tokenCiphertext: 'ciphertext', tokenIv: 'iv', tokenAuthTag: 'tag',
  };
  const claimNext = jest.fn();
  const complete = jest.fn();
  const fail = jest.fn();
  const decrypt = jest.fn().mockReturnValue('plaintext-device-token');
  const send = jest.fn();
  const service = new NotificationDeliveryService({
    claimNext, complete, fail,
  } as unknown as NotificationDeliveryDao, {
    decrypt,
  } as unknown as NotificationTokenCryptoService, {
    send,
  });

  beforeEach(() => jest.clearAllMocks());

  it('returns idle without invoking the provider when no row is claimable', async () => {
    claimNext.mockResolvedValue(undefined);
    await expect(service.processNext()).resolves.toEqual({ status: 'IDLE' });
    expect(send).not.toHaveBeenCalled();
  });

  it('delivers an encrypted-token claim and records the provider identifier', async () => {
    claimNext.mockResolvedValue(claim);
    send.mockResolvedValue({ providerMessageId: 'projects/test/messages/1' });
    await expect(service.processNext()).resolves.toEqual({
      status: 'DELIVERED', notificationId: 'notification-id',
    });
    expect(send).toHaveBeenCalledWith({
      recipientToken: 'plaintext-device-token', title: 'Alert',
      message: 'Review required', data: { notificationId: 'notification-id' },
    });
    expect(complete).toHaveBeenCalledWith(claim, 'projects/test/messages/1');
  });

  it('defers a retryable provider failure without persisting its message or token', async () => {
    claimNext.mockResolvedValue(claim);
    send.mockRejectedValue(new PushProviderError('FCM_TIMEOUT', true));
    const now = new Date('2026-08-12T12:00:00.000Z');
    await expect(service.processNext(now)).resolves.toEqual({
      status: 'DEFERRED', notificationId: 'notification-id', errorCode: 'FCM_TIMEOUT',
    });
    expect(fail).toHaveBeenCalledWith(
      claim, 'FCM_TIMEOUT', true, new Date('2026-08-12T12:00:30.000Z'),
    );
  });

  it('uses bounded retry backoff', () => {
    expect(retryDelayMs(1)).toBe(30_000);
    expect(retryDelayMs(2)).toBe(300_000);
    expect(retryDelayMs(3)).toBe(300_000);
  });

  it('moves the third retryable failure to terminal failed state', async () => {
    const exhausted = { ...claim, attemptNo: 3 };
    claimNext.mockResolvedValue(exhausted);
    send.mockRejectedValue(new PushProviderError('FCM_HTTP_503', true));
    await expect(service.processNext(new Date('2026-08-12T12:00:00.000Z')))
      .resolves.toEqual({
        status: 'FAILED', notificationId: 'notification-id',
        errorCode: 'FCM_HTTP_503',
      });
    expect(fail).toHaveBeenCalledWith(
      exhausted, 'FCM_HTTP_503', true,
      new Date('2026-08-12T12:05:00.000Z'),
    );
  });
});
