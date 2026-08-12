import { Injectable } from '@nestjs/common';
import {
  VerifyEtErrorCode,
  VerifyEtProviderError,
} from './verify-et-provider.error';

const MAX_RETRY_AFTER_SECONDS = 86_400;

const statusPolicy: Record<
  number,
  { code: VerifyEtErrorCode; retryable: boolean }
> = {
  401: { code: 'AUTHENTICATION_FAILED', retryable: false },
  402: { code: 'PROVIDER_CREDITS_EXHAUSTED', retryable: false },
  403: { code: 'PROVIDER_FORBIDDEN', retryable: false },
  409: { code: 'PROVIDER_CONFLICT', retryable: false },
  422: { code: 'INVALID_PROVIDER_REQUEST', retryable: false },
  429: { code: 'RATE_LIMITED', retryable: true },
  503: { code: 'PROVIDER_UNAVAILABLE', retryable: true },
};

@Injectable()
export class VerifyEtErrorMapperService {
  fromHttpStatus(
    status: number,
    retryAfter: string | null = null,
    now = new Date(),
  ): VerifyEtProviderError {
    const policy = statusPolicy[status] ?? {
      code: 'UNEXPECTED_PROVIDER_RESPONSE' as const,
      retryable: status >= 500,
    };
    return new VerifyEtProviderError(
      policy.code,
      policy.retryable,
      status,
      policy.retryable ? this.retryAfterSeconds(retryAfter, now) : undefined,
    );
  }

  fromNetworkFailure(): VerifyEtProviderError {
    return new VerifyEtProviderError('PROVIDER_UNAVAILABLE', true);
  }

  private retryAfterSeconds(
    value: string | null,
    now: Date,
  ): number | undefined {
    if (!value) return undefined;
    if (/^\d{1,6}$/u.test(value)) {
      return Math.min(Number(value), MAX_RETRY_AFTER_SECONDS);
    }
    const timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) return undefined;
    const seconds = Math.ceil((timestamp - now.getTime()) / 1_000);
    if (seconds <= 0) return undefined;
    return Math.min(seconds, MAX_RETRY_AFTER_SECONDS);
  }
}
