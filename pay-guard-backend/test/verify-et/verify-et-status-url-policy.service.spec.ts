import { AppConfig } from '../../src/config/app-config';
import { VerifyEtCredentialService } from '../../src/verify-et/verify-et-credential.service';
import { VerifyEtProviderError } from '../../src/verify-et/verify-et-provider.error';
import { VerifyEtStatusUrlPolicyService } from '../../src/verify-et/verify-et-status-url-policy.service';

function config(enabled: boolean): AppConfig {
  return {
    jwtAccessSecret: 'jwt-secret-that-is-at-least-32-characters',
    verifyEt: {
      enabled,
      baseUrl: enabled ? 'https://verify-et.example.test/api/v1/' : undefined,
      apiKey: enabled
        ? 'verify-et-managed-key-at-least-32-characters'
        : undefined,
      timeoutMs: 8_000,
      maxResponseBytes: 65_536,
      maxPollAttempts: 6,
      initialPollDelayMs: 2_000,
      maxPollDelayMs: 30_000,
    },
  } as AppConfig;
}

describe('VerifyEtStatusUrlPolicyService', () => {
  const policy = new VerifyEtStatusUrlPolicyService(
    new VerifyEtCredentialService(config(true)),
  );

  it.each([
    [
      'same-origin absolute URL',
      'https://verify-et.example.test/status/123?opaque=value',
      'https://verify-et.example.test/status/123?opaque=value',
    ],
    [
      'same-origin relative URL',
      '../status/123?opaque=value',
      'https://verify-et.example.test/api/status/123?opaque=value',
    ],
  ])('accepts a %s', (_label, returnedUrl, expected) => {
    expect(policy.validate(returnedUrl)).toBe(expected);
  });

  it.each([
    'http://verify-et.example.test/status/123',
    'https://verify-et.example.test.evil.test/status/123',
    '//evil.example.test/status/123',
    'https://user@verify-et.example.test/status/123',
    'https://verify-et.example.test/status/123#fragment',
  ])('rejects untrusted returned URL %s', (returnedUrl) => {
    expect(() => policy.validate(returnedUrl)).toThrow(
      'Verify.ET status URL is not trusted',
    );
  });

  it('rejects malformed and oversized values without reflecting them', () => {
    expect(() => policy.validate('https://[invalid')).toThrow(
      'Verify.ET status URL is invalid',
    );
    expect(() => policy.validate(`/${'a'.repeat(2_048)}`)).toThrow(
      'Verify.ET status URL is invalid',
    );
  });

  it('fails closed when Verify.ET is disabled', () => {
    const disabled = new VerifyEtStatusUrlPolicyService(
      new VerifyEtCredentialService(config(false)),
    );

    try {
      disabled.validate('https://verify-et.example.test/status/123');
      throw new Error('Expected disabled provider error');
    } catch (error) {
      expect(error).toBeInstanceOf(VerifyEtProviderError);
      expect(error).toMatchObject({ code: 'PROVIDER_DISABLED' });
    }
  });
});
