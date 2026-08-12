import { createSign } from 'node:crypto';
import { AppConfig } from '../config/app-config';
import {
  PushMessage, PushNotificationPort, PushProviderError,
} from './push-notification.port';

type AccessToken = { value: string; expiresAt: number };

export class FirebaseHttpV1Adapter implements PushNotificationPort {
  private accessToken?: AccessToken;

  constructor(private readonly config: AppConfig['firebase']) {}

  async send(message: PushMessage): Promise<{ providerMessageId: string }> {
    const token = await this.requireAccessToken();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(
        `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId!)}/messages:send`,
        {
          method: 'POST', signal: controller.signal,
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ message: {
            token: message.recipientToken,
            notification: { title: message.title, body: message.message },
            data: message.data,
          } }),
        },
      );
      if (!response.ok) {
        throw new PushProviderError(`FCM_HTTP_${response.status}`,
          response.status === 429 || response.status >= 500);
      }
      const body = await response.json() as { name?: unknown };
      if (typeof body.name !== 'string' || body.name.length > 512) {
        throw new PushProviderError('FCM_INVALID_RESPONSE', true);
      }
      return { providerMessageId: body.name };
    } catch (error) {
      if (error instanceof PushProviderError) throw error;
      throw new PushProviderError(
        error instanceof Error && error.name === 'AbortError'
          ? 'FCM_TIMEOUT' : 'FCM_NETWORK_ERROR', true,
      );
    } finally { clearTimeout(timeout); }
  }

  private async requireAccessToken(): Promise<string> {
    if (this.accessToken && this.accessToken.expiresAt > Date.now() + 60_000) {
      return this.accessToken.value;
    }
    const now = Math.floor(Date.now() / 1000);
    const assertion = this.serviceAccountAssertion(now);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', signal: controller.signal,
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion,
        }),
      });
      if (!response.ok) throw new PushProviderError(
        `FCM_AUTH_HTTP_${response.status}`, response.status >= 500,
      );
      const body = await response.json() as { access_token?: unknown; expires_in?: unknown };
      if (typeof body.access_token !== 'string') {
        throw new PushProviderError('FCM_AUTH_INVALID_RESPONSE', true);
      }
      const expiresIn = typeof body.expires_in === 'number' ? body.expires_in : 3600;
      this.accessToken = {
        value: body.access_token, expiresAt: Date.now() + expiresIn * 1000,
      };
      return body.access_token;
    } catch (error) {
      if (error instanceof PushProviderError) throw error;
      throw new PushProviderError('FCM_AUTH_NETWORK_ERROR', true);
    } finally { clearTimeout(timeout); }
  }

  private serviceAccountAssertion(now: number): string {
    const header = encode({ alg: 'RS256', typ: 'JWT' });
    const payload = encode({
      iss: this.config.clientEmail,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
    });
    const unsigned = `${header}.${payload}`;
    const signature = createSign('RSA-SHA256').update(unsigned).end()
      .sign(this.config.privateKey!).toString('base64url');
    return `${unsigned}.${signature}`;
  }
}

function encode(value: object) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
