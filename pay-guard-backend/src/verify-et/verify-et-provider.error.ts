export type VerifyEtErrorCode =
  | 'PROVIDER_DISABLED'
  | 'AUTHENTICATION_FAILED'
  | 'PROVIDER_CREDITS_EXHAUSTED'
  | 'PROVIDER_FORBIDDEN'
  | 'PROVIDER_CONFLICT'
  | 'INVALID_PROVIDER_REQUEST'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'UNEXPECTED_PROVIDER_RESPONSE';

export class VerifyEtProviderError extends Error {
  readonly name = 'VerifyEtProviderError';

  constructor(
    readonly code: VerifyEtErrorCode,
    readonly retryable: boolean,
    readonly providerStatus?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super('Verify.ET request failed');
  }
}
