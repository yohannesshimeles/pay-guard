import { AppConfig } from '../../src/config/app-config';
import { VerifyEtCredentialService } from '../../src/verify-et/verify-et-credential.service';
import { VerifyEtProviderError } from '../../src/verify-et/verify-et-provider.error';

function config(enabled: boolean): AppConfig {
  return {
    verifyEt: {
      enabled,
      baseUrl: enabled ? 'https://verify-et.example.test/api/' : undefined,
      apiKey: enabled
        ? 'managed-verify-et-test-key-at-least-32-characters'
        : undefined,
      timeoutMs: 8_000,
      maxResponseBytes: 65_536,
      maxPollAttempts: 6,
      initialPollDelayMs: 2_000,
      maxPollDelayMs: 30_000,
    },
  } as AppConfig;
}

describe('VerifyEtCredentialService', () => {
  it('fails closed without exposing configuration when the provider is disabled', () => {
    const service = new VerifyEtCredentialService(config(false));

    try {
      service.getEnabledConfig();
      throw new Error('Expected disabled provider error');
    } catch (error) {
      expect(error).toBeInstanceOf(VerifyEtProviderError);
      expect(error).toMatchObject({
        code: 'PROVIDER_DISABLED',
        retryable: false,
        message: 'Verify.ET request failed',
      });
    }
  });

  it('returns a frozen internal credential view when explicitly enabled', () => {
    const enabled = new VerifyEtCredentialService(
      config(true),
    ).getEnabledConfig();

    expect(enabled).toEqual({
      baseUrl: 'https://verify-et.example.test/api/',
      apiKey: 'managed-verify-et-test-key-at-least-32-characters',
      timeoutMs: 8_000,
      maxResponseBytes: 65_536,
      maxPollAttempts: 6,
      initialPollDelayMs: 2_000,
      maxPollDelayMs: 30_000,
    });
    expect(Object.isFrozen(enabled)).toBe(true);
  });
});
