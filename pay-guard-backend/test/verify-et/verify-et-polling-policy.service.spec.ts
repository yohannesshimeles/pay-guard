import { AppConfig } from '../../src/config/app-config';
import { VerifyEtPollingPolicyService } from '../../src/verify-et/verify-et-polling-policy.service';
import { VerifyEtProviderError } from '../../src/verify-et/verify-et-provider.error';

const config = {
  verifyEt: {
    enabled: true,
    timeoutMs: 8_000,
    maxResponseBytes: 65_536,
    maxPollAttempts: 6,
    initialPollDelayMs: 2_000,
    maxPollDelayMs: 30_000,
  },
} as AppConfig;

describe('VerifyEtPollingPolicyService', () => {
  const policy = new VerifyEtPollingPolicyService(config);
  const now = new Date('2026-08-06T12:00:00.000Z');
  const requestKey = 'verify-request:provider:12345';

  it('schedules bounded exponential backoff with stable jitter', () => {
    const first = policy.planPending({
      requestKey,
      attemptsCompleted: 0,
      now,
    });
    const repeated = policy.planPending({
      requestKey,
      attemptsCompleted: 0,
      now,
    });

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ action: 'SCHEDULE', nextAttempt: 1 });
    if (first.action !== 'SCHEDULE') throw new Error('Expected a schedule');
    expect(first.delayMs).toBeGreaterThanOrEqual(1_600);
    expect(first.delayMs).toBeLessThanOrEqual(2_400);
    expect(first.scheduledAt.getTime()).toBe(now.getTime() + first.delayMs);
  });

  it('caps jittered exponential delay at the configured maximum', () => {
    const decision = policy.planPending({
      requestKey,
      attemptsCompleted: 5,
      now,
    });

    expect(decision).toMatchObject({ action: 'SCHEDULE', nextAttempt: 6 });
    if (decision.action !== 'SCHEDULE') throw new Error('Expected a schedule');
    expect(decision.delayMs).toBeLessThanOrEqual(30_000);
  });

  it('honors a valid Retry-After minimum over exponential delay', () => {
    const decision = policy.planPending({
      requestKey,
      attemptsCompleted: 1,
      retryAfterSeconds: 90,
      now,
    });

    expect(decision).toEqual({
      action: 'SCHEDULE',
      nextAttempt: 2,
      delayMs: 90_000,
      scheduledAt: new Date('2026-08-06T12:01:30.000Z'),
    });
  });

  it('stops non-retryable errors and exhausted polling', () => {
    expect(
      policy.planRetry({
        requestKey,
        attemptsCompleted: 0,
        error: new VerifyEtProviderError('PROVIDER_FORBIDDEN', false),
      }),
    ).toEqual({ action: 'STOP', reason: 'NON_RETRYABLE' });
    expect(policy.planPending({ requestKey, attemptsCompleted: 6 })).toEqual({
      action: 'STOP',
      reason: 'ATTEMPT_LIMIT',
    });
  });

  it('uses sanitized retry metadata from provider errors', () => {
    const decision = policy.planRetry({
      requestKey,
      attemptsCompleted: 0,
      error: new VerifyEtProviderError('RATE_LIMITED', true, 429, 60),
      now,
    });

    expect(decision).toMatchObject({ action: 'SCHEDULE', delayMs: 60_000 });
  });

  it('rejects malformed request keys, attempt counts and Retry-After values', () => {
    expect(() =>
      policy.planPending({ requestKey: 'short', attemptsCompleted: 0 }),
    ).toThrow('request key is invalid');
    expect(() =>
      policy.planPending({ requestKey, attemptsCompleted: -1 }),
    ).toThrow('attempt count is invalid');
    expect(() =>
      policy.planPending({
        requestKey,
        attemptsCompleted: 0,
        retryAfterSeconds: 86_401,
      }),
    ).toThrow('Retry-After value is invalid');
  });
});
