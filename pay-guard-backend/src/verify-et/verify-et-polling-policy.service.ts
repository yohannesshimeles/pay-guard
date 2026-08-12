import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app-config';
import { VerifyEtProviderError } from './verify-et-provider.error';

const MAX_RETRY_AFTER_SECONDS = 86_400;

export type VerifyEtPollDecision =
  | Readonly<{
      action: 'SCHEDULE';
      nextAttempt: number;
      delayMs: number;
      scheduledAt: Date;
    }>
  | Readonly<{
      action: 'STOP';
      reason: 'NON_RETRYABLE' | 'ATTEMPT_LIMIT';
    }>;

@Injectable()
export class VerifyEtPollingPolicyService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  planPending(input: {
    requestKey: string;
    attemptsCompleted: number;
    retryAfterSeconds?: number;
    now?: Date;
  }): VerifyEtPollDecision {
    this.validateInput(input);
    if (input.attemptsCompleted >= this.config.verifyEt.maxPollAttempts) {
      return { action: 'STOP', reason: 'ATTEMPT_LIMIT' };
    }

    const exponentialDelay = Math.min(
      this.config.verifyEt.initialPollDelayMs *
        2 ** Math.max(0, input.attemptsCompleted),
      this.config.verifyEt.maxPollDelayMs,
    );
    const jitteredDelay = Math.min(
      Math.round(
        exponentialDelay *
          this.jitterFactor(input.requestKey, input.attemptsCompleted),
      ),
      this.config.verifyEt.maxPollDelayMs,
    );
    const retryAfterMs = (input.retryAfterSeconds ?? 0) * 1_000;
    const delayMs = Math.max(jitteredDelay, retryAfterMs);
    const now = input.now ?? new Date();

    return {
      action: 'SCHEDULE',
      nextAttempt: input.attemptsCompleted + 1,
      delayMs,
      scheduledAt: new Date(now.getTime() + delayMs),
    };
  }

  planRetry(input: {
    requestKey: string;
    attemptsCompleted: number;
    error: VerifyEtProviderError;
    now?: Date;
  }): VerifyEtPollDecision {
    if (!input.error.retryable) {
      return { action: 'STOP', reason: 'NON_RETRYABLE' };
    }
    return this.planPending({
      requestKey: input.requestKey,
      attemptsCompleted: input.attemptsCompleted,
      retryAfterSeconds: input.error.retryAfterSeconds,
      now: input.now,
    });
  }

  private validateInput(input: {
    requestKey: string;
    attemptsCompleted: number;
    retryAfterSeconds?: number;
  }): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u.test(input.requestKey)) {
      throw new Error('Verify.ET polling request key is invalid');
    }
    if (
      !Number.isInteger(input.attemptsCompleted) ||
      input.attemptsCompleted < 0
    ) {
      throw new Error('Verify.ET polling attempt count is invalid');
    }
    if (
      input.retryAfterSeconds !== undefined &&
      (!Number.isInteger(input.retryAfterSeconds) ||
        input.retryAfterSeconds < 0 ||
        input.retryAfterSeconds > MAX_RETRY_AFTER_SECONDS)
    ) {
      throw new Error('Verify.ET Retry-After value is invalid');
    }
  }

  private jitterFactor(requestKey: string, attemptsCompleted: number): number {
    const digest = createHash('sha256')
      .update(`${requestKey}:${attemptsCompleted}`, 'utf8')
      .digest();
    const unit = digest.readUInt16BE(0) / 65_535;
    return 0.8 + unit * 0.4;
  }
}
