import { VerifyEtErrorMapperService } from '../../src/verify-et/verify-et-error-mapper.service';

describe('VerifyEtErrorMapperService', () => {
  const mapper = new VerifyEtErrorMapperService();

  it.each([
    [401, 'AUTHENTICATION_FAILED', false],
    [402, 'PROVIDER_CREDITS_EXHAUSTED', false],
    [403, 'PROVIDER_FORBIDDEN', false],
    [409, 'PROVIDER_CONFLICT', false],
    [422, 'INVALID_PROVIDER_REQUEST', false],
    [429, 'RATE_LIMITED', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
  ] as const)('maps provider status %i to %s', (status, code, retryable) => {
    expect(mapper.fromHttpStatus(status)).toMatchObject({
      code,
      retryable,
      providerStatus: status,
      message: 'Verify.ET request failed',
    });
  });

  it('bounds delta-seconds and HTTP-date Retry-After values', () => {
    expect(mapper.fromHttpStatus(429, '999999').retryAfterSeconds).toBe(86_400);
    expect(
      mapper.fromHttpStatus(
        503,
        'Thu, 06 Aug 2026 00:01:30 GMT',
        new Date('2026-08-06T00:00:00.000Z'),
      ).retryAfterSeconds,
    ).toBe(90);
    expect(
      mapper.fromHttpStatus(429, 'invalid').retryAfterSeconds,
    ).toBeUndefined();
  });

  it('sanitizes network and unknown provider failures', () => {
    expect(mapper.fromNetworkFailure()).toMatchObject({
      code: 'PROVIDER_UNAVAILABLE',
      retryable: true,
      message: 'Verify.ET request failed',
    });
    expect(mapper.fromHttpStatus(418)).toMatchObject({
      code: 'UNEXPECTED_PROVIDER_RESPONSE',
      retryable: false,
    });
    expect(mapper.fromHttpStatus(500)).toMatchObject({
      code: 'UNEXPECTED_PROVIDER_RESPONSE',
      retryable: true,
    });
  });
});
