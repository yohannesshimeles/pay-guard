import { AppConfig } from '../../src/config/app-config';
import { VerifyEtCredentialService } from '../../src/verify-et/verify-et-credential.service';
import { VerifyEtErrorMapperService } from '../../src/verify-et/verify-et-error-mapper.service';
import { HttpVerifyEtProviderAdapter } from '../../src/verify-et/verify-et-provider.adapter';
import { VerifyEtProviderError } from '../../src/verify-et/verify-et-provider.error';
import { VerifyEtStatusUrlPolicyService } from '../../src/verify-et/verify-et-status-url-policy.service';

describe('HttpVerifyEtProviderAdapter official REST contract', () => {
  const config = {
    verifyEt: {
      enabled: true,
      baseUrl: 'https://verify.et',
      apiKey: 'VERIFY_BANK_ET_test_key_at_least_32_characters',
      webhookUrl: 'https://payguard.example/api/v1/webhooks/verify-et',
      webhookSecret: 'verify-et-webhook-test-secret-at-least-32-characters',
      waitMs: 5_000,
      timeoutMs: 8_000,
      maxResponseBytes: 65_536,
      maxPollAttempts: 6,
      initialPollDelayMs: 2_000,
      maxPollDelayMs: 30_000,
    },
  } as AppConfig;
  const credentials = new VerifyEtCredentialService(config);
  const adapter = new HttpVerifyEtProviderAdapter(
    credentials,
    new VerifyEtErrorMapperService(),
    new VerifyEtStatusUrlPolicyService(credentials),
  );
  const request = {
    idempotencyKey: 'verifyet:status:11111111-1111-4111-8111-111111111111',
    verificationAttemptId: '11111111-1111-4111-8111-111111111111',
    bankId: '22222222-2222-4222-8222-222222222222',
    bankCode: 'CBE',
    transactionReference: 'FT1234567890',
    amount: '1500.00',
    receiverAccountSuffix: '12345678',
  };
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });

  afterEach(() => jest.restoreAllMocks());

  it('submits CBE verification with API key, idempotency, wait, and webhook fields', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      message: 'Verification queued.',
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      verification: {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        processingStatus: 'queued',
        status: 'pending',
        verified: false,
      },
      links: {
        statusUrl: '/api/verify/550e8400-e29b-41d4-a716-446655440000',
        pollAfterMs: 1500,
        webhookRegistered: true,
      },
    }), { status: 202, headers: { 'content-type': 'application/json' } }));

    await expect(adapter.verify(request)).resolves.toMatchObject({
      result: 'PENDING',
      providerRequestId: '550e8400-e29b-41d4-a716-446655440000',
      providerStatus: 'PENDING',
    });
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('Expected Verify.ET fetch call');
    const [url, init] = call;
    expect(url instanceof URL ? url.href : url instanceof Request ? url.url : url)
      .toBe('https://verify.et/api/verify?waitMs=5000');
    expect(new Headers(init?.headers).get('x-api-key')).toBe(config.verifyEt.apiKey);
    expect(new Headers(init?.headers).get('idempotency-key')).toBe(
      request.idempotencyKey,
    );
    if (typeof init?.body !== 'string') throw new Error('Expected JSON request body');
    expect(JSON.parse(init.body) as unknown).toEqual({
      bank: 'cbe',
      referenceNumber: 'FT1234567890',
      accountSuffix: '12345678',
      webhookUrl: config.verifyEt.webhookUrl,
    });
  });

  it('normalizes a completed verification for PayGuard matching', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      requestId: '550e8400-e29b-41d4-a716-446655440000',
      verification: { processingStatus: 'completed', status: 'success', verified: true },
      data: [{
        status: 'success', verified: true, amount: 1500,
        referenceNumber: 'FT1234567890', receiverAccount: '2519****5678',
        timestamp: '2026-02-20T12:00:00.000Z',
        settlementAccountMatch: { matchedSettlementAccount: '1000012345678' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(adapter.verify(request)).resolves.toMatchObject({
      result: 'VERIFIED',
      providerBankId: request.bankId,
      transactionReference: request.transactionReference,
      amount: '1500.00',
      receiverAccountSuffix: '12345678',
      providerTransactionAt: new Date('2026-02-20T12:00:00.000Z'),
    });
  });

  it('polls the documented status endpoint after a queued submission', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: {
        requestId: '550e8400-e29b-41d4-a716-446655440000',
        processingStatus: 'running', status: 'pending', verified: false,
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(adapter.verify({
      ...request,
      providerRequestId: '550e8400-e29b-41d4-a716-446655440000',
    })).resolves.toMatchObject({ result: 'PENDING', providerStatus: 'PENDING' });
    const call = fetchMock.mock.calls[0];
    if (!call) throw new Error('Expected Verify.ET fetch call');
    const [url, init] = call;
    expect(url instanceof URL ? url.href : url instanceof Request ? url.url : url)
      .toBe('https://verify.et/api/verify/550e8400-e29b-41d4-a716-446655440000');
    expect(init?.method).toBe('GET');
    expect(init?.body).toBeUndefined();
    expect(new Headers(init?.headers).get('idempotency-key')).toBeNull();
  });

  it('maps documented HTTP failures and Retry-After without exposing response bodies', async () => {
    fetchMock.mockResolvedValue(new Response('{"message":"rate limited"}', {
      status: 429,
      headers: { 'retry-after': '30' },
    }));

    await expect(adapter.verify(request)).rejects.toEqual(
      expect.objectContaining<Partial<VerifyEtProviderError>>({
        code: 'RATE_LIMITED', retryable: true, providerStatus: 429,
        retryAfterSeconds: 30,
      }),
    );
  });
});
