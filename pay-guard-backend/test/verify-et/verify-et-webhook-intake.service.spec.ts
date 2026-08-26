import { createHmac } from 'node:crypto';
import { AppConfig } from '../../src/config/app-config';
import { VerifyEtCredentialService } from '../../src/verify-et/verify-et-credential.service';
import { VerifyEtWebhookDeliveryDao } from '../../src/verify-et/verify-et-webhook-delivery.dao';
import { VerifyEtWebhookIntakeService } from '../../src/verify-et/verify-et-webhook-intake.service';
import {
  UnconfiguredVerifyEtWebhookSignatureVerifier,
  HmacVerifyEtWebhookSignatureVerifier,
  VerifyEtWebhookSignatureUnavailableError,
  VerifyEtWebhookSignatureVerifier,
} from '../../src/verify-et/verify-et-webhook-signature-verifier';

function config(enabled: boolean, maxResponseBytes = 65_536): AppConfig {
  return {
    verifyEt: {
      enabled,
      timeoutMs: 8_000,
      maxResponseBytes,
      maxPollAttempts: 6,
      initialPollDelayMs: 2_000,
      maxPollDelayMs: 30_000,
    },
  } as AppConfig;
}

describe('VerifyEtWebhookIntakeService', () => {
  const verify = jest.fn<
    ReturnType<VerifyEtWebhookSignatureVerifier['verify']>,
    Parameters<VerifyEtWebhookSignatureVerifier['verify']>
  >();
  const reserveVerified = jest.fn();
  const verifier = { verify } satisfies VerifyEtWebhookSignatureVerifier;
  const deliveries = {
    reserveVerified,
  } as unknown as VerifyEtWebhookDeliveryDao;
  const body = Buffer.from('{"status":"VERIFIED"}', 'utf8');

  beforeEach(() => jest.clearAllMocks());

  it('fails closed before verification when Verify.ET is disabled', async () => {
    const intake = new VerifyEtWebhookIntakeService(
      config(false),
      verifier,
      deliveries,
    );

    await expect(intake.accept(body, {})).rejects.toBeInstanceOf(
      VerifyEtWebhookSignatureUnavailableError,
    );
    expect(verify).not.toHaveBeenCalled();
    expect(reserveVerified).not.toHaveBeenCalled();
  });

  it('rejects empty and oversized bodies before signature processing', async () => {
    const intake = new VerifyEtWebhookIntakeService(
      config(true, 8),
      verifier,
      deliveries,
    );

    await expect(intake.accept(Buffer.alloc(0), {})).rejects.toThrow(
      'body is empty',
    );
    await expect(intake.accept(body, {})).rejects.toThrow(
      'exceeds the configured limit',
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('persists a delivery only after successful signature verification', async () => {
    verify.mockResolvedValue({
      deliveryId: 'delivery:provider:12345',
      eventType: 'verification.completed',
    });
    reserveVerified.mockResolvedValue({
      duplicate: false,
      delivery: { id: 'delivery-record-id' },
    });
    const intake = new VerifyEtWebhookIntakeService(
      config(true),
      verifier,
      deliveries,
    );

    await expect(
      intake.accept(body, { 'content-type': 'application/json' }),
    ).resolves.toMatchObject({ duplicate: false });
    expect(verify).toHaveBeenCalledWith({
      rawBody: body,
      headers: { 'content-type': 'application/json' },
    });
    expect(reserveVerified).toHaveBeenCalledWith({
      deliveryId: 'delivery:provider:12345',
      eventType: 'verification.completed',
      rawBody: body,
      maxPayloadBytes: 65_536,
    });
  });

  it('does not persist a delivery when verification fails', async () => {
    verify.mockRejectedValue(new Error('invalid signature'));
    const intake = new VerifyEtWebhookIntakeService(
      config(true),
      verifier,
      deliveries,
    );

    await expect(intake.accept(body, {})).rejects.toThrow('invalid signature');
    expect(reserveVerified).not.toHaveBeenCalled();
  });
});

describe('UnconfiguredVerifyEtWebhookSignatureVerifier', () => {
  it('always denies webhook requests without guessing a vendor algorithm', async () => {
    const verifier = new UnconfiguredVerifyEtWebhookSignatureVerifier();

    await expect(
      verifier.verify({ rawBody: Buffer.from('{}'), headers: {} }),
    ).rejects.toBeInstanceOf(VerifyEtWebhookSignatureUnavailableError);
  });
});

describe('HmacVerifyEtWebhookSignatureVerifier official signature contract', () => {
  it('verifies sha256 HMAC over timestamp.rawBody and returns delivery metadata', async () => {
    const secret = 'verify-et-webhook-test-secret-at-least-32-characters';
    const rawBody = Buffer.from(JSON.stringify({
      event: 'verification.completed', requestId: 'request-12345',
    }));
    const timestamp = '2026-02-20T12:00:02.500Z';
    const signature = `sha256=${createHmac('sha256', secret)
      .update(`${timestamp}.`, 'utf8').update(rawBody).digest('hex')}`;
    const verifier = new HmacVerifyEtWebhookSignatureVerifier(
      new VerifyEtCredentialService({
          verifyEt: {
            enabled: true, baseUrl: 'https://verify.et',
            apiKey: 'VERIFY_BANK_ET_test_key_at_least_32_characters',
            webhookSecret: secret, waitMs: 5_000, timeoutMs: 8_000,
            maxResponseBytes: 65_536, maxPollAttempts: 6,
            initialPollDelayMs: 2_000, maxPollDelayMs: 30_000,
          },
        } as AppConfig),
    );

    await expect(verifier.verify({ rawBody, headers: {
      'x-webhook-timestamp': timestamp,
      'x-webhook-signature': signature,
      'x-webhook-delivery-id': 'delivery:provider:12345',
      'x-webhook-event': 'verification.completed',
    } })).resolves.toEqual({
      deliveryId: 'delivery:provider:12345',
      eventType: 'verification.completed',
    });
  });

  it('rejects a mismatched signature', async () => {
    const verifier = new HmacVerifyEtWebhookSignatureVerifier(
      new VerifyEtCredentialService({
          verifyEt: {
            enabled: true, baseUrl: 'https://verify.et',
            apiKey: 'VERIFY_BANK_ET_test_key_at_least_32_characters',
            webhookSecret: 'verify-et-webhook-test-secret-at-least-32-characters',
            waitMs: 5_000, timeoutMs: 8_000, maxResponseBytes: 65_536,
            maxPollAttempts: 6, initialPollDelayMs: 2_000,
            maxPollDelayMs: 30_000,
          },
        } as AppConfig),
    );
    await expect(verifier.verify({ rawBody: Buffer.from('{}'), headers: {
      'x-webhook-timestamp': 'timestamp',
      'x-webhook-signature': `sha256=${'0'.repeat(64)}`,
      'x-webhook-delivery-id': 'delivery:provider:12345',
      'x-webhook-event': 'verification.completed',
    } })).rejects.toThrow('signature is invalid');
  });
});
