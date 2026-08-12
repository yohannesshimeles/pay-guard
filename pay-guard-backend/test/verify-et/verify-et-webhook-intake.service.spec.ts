import { AppConfig } from '../../src/config/app-config';
import { VerifyEtWebhookDeliveryDao } from '../../src/verify-et/verify-et-webhook-delivery.dao';
import { VerifyEtWebhookIntakeService } from '../../src/verify-et/verify-et-webhook-intake.service';
import {
  UnconfiguredVerifyEtWebhookSignatureVerifier,
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
