import { generateKeyPairSync } from 'node:crypto';
import { FirebaseHttpV1Adapter } from '../../src/notifications/firebase-http-v1.adapter';
import { PushProviderError } from '../../src/notifications/push-notification.port';

describe('FirebaseHttpV1Adapter contract', () => {
  const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 })
    .privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  const originalFetch = global.fetch;
  const fetchMock = jest.fn<
    Promise<Response>,
    [input: string | URL | Request, init?: RequestInit]
  >();
  const adapter = new FirebaseHttpV1Adapter({
    enabled: true, projectId: 'payguard-test',
    clientEmail: 'firebase@example.iam.gserviceaccount.com',
    privateKey, timeoutMs: 2_000,
  });

  beforeAll(() => { global.fetch = fetchMock as typeof fetch; });
  afterAll(() => { global.fetch = originalFetch; });
  beforeEach(() => jest.clearAllMocks());

  it('exchanges a signed service-account assertion and sends the HTTP v1 shape', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'oauth-access-token', expires_in: 3600,
      }), { status: 200, headers: { 'content-type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        name: 'projects/payguard-test/messages/message-1',
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(adapter.send({
      recipientToken: 'sensitive-device-token', title: 'Alert',
      message: 'Review required', data: { notificationId: 'notification-id' },
    })).resolves.toEqual({
      providerMessageId: 'projects/payguard-test/messages/message-1',
    });

    const oauthCall = fetchMock.mock.calls[0];
    const sendCall = fetchMock.mock.calls[1];
    expect(oauthCall[0]).toBe('https://oauth2.googleapis.com/token');
    const oauthBody = oauthCall[1]!.body as URLSearchParams;
    expect(oauthBody.get('assertion')?.split('.')).toHaveLength(3);
    expect(sendCall[0]).toBe(
      'https://fcm.googleapis.com/v1/projects/payguard-test/messages:send',
    );
    expect((sendCall[1]!.headers as Record<string, string>).authorization)
      .toBe('Bearer oauth-access-token');
    const request = JSON.parse(sendCall[1]!.body as string) as {
      message: { token: string; data: Record<string, string> };
    };
    expect(request.message).toMatchObject({
      token: 'sensitive-device-token',
      data: { notificationId: 'notification-id' },
    });
  });

  it('classifies throttling as retryable without returning provider response text', async () => {
    const throttled = new FirebaseHttpV1Adapter({
      enabled: true, projectId: 'payguard-test',
      clientEmail: 'firebase@example.iam.gserviceaccount.com',
      privateKey, timeoutMs: 2_000,
    });
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'oauth-access-token', expires_in: 3600,
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response('sensitive provider detail', { status: 429 }));
    await expect(throttled.send({
      recipientToken: 'sensitive-device-token', title: 'Alert',
      message: 'Review required', data: {},
    })).rejects.toMatchObject<Partial<PushProviderError>>({
      code: 'FCM_HTTP_429', retryable: true,
    });
  });
});
