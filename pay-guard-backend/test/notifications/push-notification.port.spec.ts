import {
  PushProviderNotConfiguredError, UnconfiguredPushNotificationAdapter,
} from '../../src/notifications/push-notification.port';

describe('UnconfiguredPushNotificationAdapter', () => {
  it('fails closed without exposing or inventing Firebase credentials', async () => {
    const adapter = new UnconfiguredPushNotificationAdapter();
    await expect(adapter.send({
      recipientToken: 'test-token', title: 'Title', message: 'Message', data: {},
    })).rejects.toBeInstanceOf(PushProviderNotConfiguredError);
  });
});

