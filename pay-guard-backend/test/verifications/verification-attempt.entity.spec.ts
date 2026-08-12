import {
  VerificationAttemptEntity,
  VerificationAttemptEntityProps,
} from '../../src/verifications/entities/verification-attempt.entity';
import { VerificationAttemptResult } from '../../src/verifications/enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';

const requestedAt = new Date('2026-08-06T12:00:00.000Z');
const respondedAt = new Date('2026-08-06T12:00:01.250Z');
const baseProps: VerificationAttemptEntityProps = {
  id: 'attempt-id',
  transactionId: 'transaction-id',
  businessId: 'business-id',
  branchId: 'branch-id',
  attemptKey: 'verification:attempt:0001',
  attemptType: VerificationAttemptType.INITIAL,
  attemptNumber: 1,
  result: VerificationAttemptResult.QUEUED,
  creditTransactionId: 'credit-id',
  createdAt: requestedAt,
};

describe('VerificationAttemptEntity', () => {
  it('models a valid sanitized provider attempt', () => {
    const attempt = new VerificationAttemptEntity({
      ...baseProps,
      result: VerificationAttemptResult.PENDING,
      requestedAt,
      respondedAt,
      responseTimeMs: 1_250,
      errorCode: 'PROVIDER_PENDING',
    });

    expect(attempt).toMatchObject({
      attemptKey: 'verification:attempt:0001',
      attemptType: VerificationAttemptType.INITIAL,
      attemptNumber: 1,
      result: VerificationAttemptResult.PENDING,
      creditTransactionId: 'credit-id',
      responseTimeMs: 1_250,
    });
  });

  it('rejects invalid attempt keys, numbers and response durations', () => {
    expect(
      () =>
        new VerificationAttemptEntity({ ...baseProps, attemptKey: 'short' }),
    ).toThrow('attempt key is invalid');
    expect(
      () => new VerificationAttemptEntity({ ...baseProps, attemptNumber: 0 }),
    ).toThrow('attempt number must be positive');
    expect(
      () => new VerificationAttemptEntity({ ...baseProps, responseTimeMs: -1 }),
    ).toThrow('response time is invalid');
  });

  it('rejects inconsistent timestamps and unsafe error details', () => {
    expect(
      () => new VerificationAttemptEntity({ ...baseProps, respondedAt }),
    ).toThrow('response requires a request timestamp');
    expect(
      () =>
        new VerificationAttemptEntity({
          ...baseProps,
          requestedAt: respondedAt,
          respondedAt: requestedAt,
        }),
    ).toThrow('response precedes its request');
    expect(
      () =>
        new VerificationAttemptEntity({
          ...baseProps,
          errorCode: 'raw provider failure detail',
        }),
    ).toThrow('error code is invalid');
  });
});
