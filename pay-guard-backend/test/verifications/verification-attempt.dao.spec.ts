import { DaoTransaction } from '../../src/database/central.dao';
import { VerificationAttemptResult } from '../../src/verifications/enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';
import {
  VerificationAttemptDao,
  VerificationAttemptIdempotencyConflictError,
  VerificationAttemptOutcomeConflictError,
} from '../../src/verifications/verification-attempt.dao';

describe('VerificationAttemptDao', () => {
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transaction = { optional, one } as unknown as DaoTransaction;
  const dao = new VerificationAttemptDao();
  const createdAt = new Date('2026-08-06T12:00:00.000Z');
  const input = {
    transactionId: 'transaction-id',
    businessId: 'business-id',
    branchId: 'branch-id',
    attemptKey: 'verification:initial:transaction-id',
    attemptType: VerificationAttemptType.INITIAL,
    creditTransactionId: 'credit-id',
  };
  const row = {
    id: 'attempt-id',
    transaction_id: input.transactionId,
    business_id: input.businessId,
    branch_id: input.branchId,
    attempt_key: input.attemptKey,
    attempt_type: input.attemptType,
    attempt_number: 1,
    result_status: VerificationAttemptResult.QUEUED,
    credit_transaction_id: input.creditTransactionId,
    provider_request_id: null,
    provider_status: null,
    requested_at: null,
    responded_at: null,
    response_time_ms: null,
    error_code: null,
    created_at: createdAt,
  };

  beforeEach(() => jest.clearAllMocks());

  it('reserves the next queued attempt bound to the initial credit event', async () => {
    optional.mockResolvedValueOnce(row);

    await expect(dao.reserveWithin(transaction, input)).resolves.toMatchObject({
      replayed: false,
      attempt: {
        id: 'attempt-id',
        attemptNumber: 1,
        result: VerificationAttemptResult.QUEUED,
        creditTransactionId: 'credit-id',
      },
    });
    expect(optional.mock.calls[0][0]).toContain(
      'ON CONFLICT (attempt_key) DO NOTHING',
    );
    expect(optional.mock.calls[0][1]).toEqual([
      'transaction-id',
      'business-id',
      'verification:initial:transaction-id',
      VerificationAttemptType.INITIAL,
      'credit-id',
    ]);
  });

  it('returns an exact concurrent replay after the unique-key conflict', async () => {
    optional.mockResolvedValueOnce(undefined).mockResolvedValueOnce(row);

    await expect(dao.reserveWithin(transaction, input)).resolves.toMatchObject({
      replayed: true,
      attempt: { id: 'attempt-id' },
    });
    expect(optional.mock.calls[1][0]).toContain('FOR UPDATE OF attempt');
  });

  it('rejects a key replayed against a different request identity', async () => {
    optional
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ ...row, transaction_id: 'other-transaction' });

    await expect(dao.reserveWithin(transaction, input)).rejects.toThrow(
      VerificationAttemptIdempotencyConflictError,
    );
  });

  it('rejects weak or malformed request keys before querying', async () => {
    await expect(
      dao.reserveWithin(transaction, { ...input, attemptKey: 'short key' }),
    ).rejects.toThrow('attempt key is invalid');
    expect(optional).not.toHaveBeenCalled();
  });

  it('finalizes a queued attempt with sanitized provider identity and timing', async () => {
    const requestedAt = new Date('2026-08-06T12:00:01.000Z');
    const respondedAt = new Date('2026-08-06T12:00:02.250Z');
    optional.mockResolvedValueOnce(row);
    one.mockResolvedValueOnce({
      ...row,
      result_status: VerificationAttemptResult.PENDING,
      provider_request_id: 'provider-request-1',
      provider_status: 'PENDING',
      requested_at: requestedAt,
      responded_at: respondedAt,
      response_time_ms: 1_250,
    });

    await expect(
      dao.finalizeWithin(transaction, {
        attemptKey: input.attemptKey,
        result: VerificationAttemptResult.PENDING,
        providerRequestId: 'provider-request-1',
        providerStatus: 'PENDING',
        requestedAt,
        respondedAt,
        responseTimeMs: 1_250,
      }),
    ).resolves.toMatchObject({
      replayed: false,
      attempt: {
        result: VerificationAttemptResult.PENDING,
        providerRequestId: 'provider-request-1',
      },
    });
    expect(one.mock.calls[0][0]).toContain("result_status = 'QUEUED'");
  });

  it('accepts only an exact finalized outcome replay', async () => {
    const requestedAt = new Date('2026-08-06T12:00:01.000Z');
    const respondedAt = new Date('2026-08-06T12:00:02.250Z');
    const finalizedRow = {
      ...row,
      result_status: VerificationAttemptResult.VERIFIED,
      provider_request_id: 'provider-request-1',
      provider_status: 'VERIFIED',
      requested_at: requestedAt,
      responded_at: respondedAt,
      response_time_ms: 1_250,
    };
    optional.mockResolvedValueOnce(finalizedRow);

    await expect(
      dao.finalizeWithin(transaction, {
        attemptKey: input.attemptKey,
        result: VerificationAttemptResult.VERIFIED,
        providerRequestId: 'provider-request-1',
        providerStatus: 'VERIFIED',
        requestedAt,
        respondedAt,
        responseTimeMs: 1_250,
      }),
    ).resolves.toMatchObject({ replayed: true });

    optional.mockResolvedValueOnce(finalizedRow);
    await expect(
      dao.finalizeWithin(transaction, {
        attemptKey: input.attemptKey,
        result: VerificationAttemptResult.DUPLICATE,
        providerRequestId: 'provider-request-1',
        providerStatus: 'DUPLICATE',
        requestedAt,
        respondedAt,
        responseTimeMs: 1_250,
      }),
    ).rejects.toThrow(VerificationAttemptOutcomeConflictError);
    expect(one).not.toHaveBeenCalled();
  });
});
