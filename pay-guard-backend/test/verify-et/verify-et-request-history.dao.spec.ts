import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  VerifyEtIdempotencyConflictError,
  VerifyEtRequestHistoryDao,
} from '../../src/verify-et/verify-et-request-history.dao';

const createdAt = new Date('2026-08-06T10:00:00.000Z');
const requestRow = {
  id: 'request-record-id',
  verification_attempt_id: 'verification-attempt-id',
  operation: 'SUBMIT' as const,
  idempotency_key: 'submit:verification-attempt-id',
  request_hash: 'a'.repeat(64),
  bank_code: 'CBE',
  amount_etb: '125.50',
  request_status: 'RESERVED' as const,
  provider_request_id: null,
  attempt_count: 0,
  last_error_code: null,
  created_at: createdAt,
  sent_at: null,
  completed_at: null,
};

describe('VerifyEtRequestHistoryDao', () => {
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transactionOne = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) =>
    work({ optional, one: transactionOne } as unknown as DaoTransaction),
  );
  const centralDao = { transaction, one } as unknown as CentralDao;
  const history = new VerifyEtRequestHistoryDao(centralDao);
  const reserveInput = {
    verificationAttemptId: requestRow.verification_attempt_id,
    operation: requestRow.operation,
    idempotencyKey: requestRow.idempotency_key,
    payload: { amount: 125.5, account: 'sanitized-reference' },
    bankCode: requestRow.bank_code,
    amountEtb: requestRow.amount_etb,
  };

  beforeEach(() => jest.clearAllMocks());

  it('reserves a new provider request using only a payload hash', async () => {
    optional.mockImplementationOnce((_sql, values = []) =>
      Promise.resolve({
        ...requestRow,
        request_hash: values[3],
      }),
    );

    await expect(history.reserve(reserveInput)).resolves.toMatchObject({
      replayed: false,
      record: { id: requestRow.id, status: 'RESERVED' },
    });
    const values = optional.mock.calls[0][1] ?? [];
    expect(values[3]).toMatch(/^[a-f0-9]{64}$/u);
    expect(values).not.toContain(reserveInput.payload);
    expect(JSON.stringify(values)).not.toContain('sanitized-reference');
    expect(transactionOne).not.toHaveBeenCalled();
  });

  it('replays an identical reservation without creating another request', async () => {
    optional.mockResolvedValue(undefined);
    transactionOne.mockImplementationOnce((_sql, values = []) => {
      const insertValues = optional.mock.calls[0][1] ?? [];
      return Promise.resolve({
        ...requestRow,
        idempotency_key: values[0],
        request_hash: insertValues[3],
      });
    });

    await expect(history.reserve(reserveInput)).resolves.toMatchObject({
      replayed: true,
      record: { idempotencyKey: reserveInput.idempotencyKey },
    });
    expect(transactionOne.mock.calls[0][0]).toContain('FOR UPDATE');
  });

  it.each([
    ['attempt', { verification_attempt_id: 'another-attempt' }],
    ['operation', { operation: 'STATUS' }],
    ['payload', { request_hash: 'b'.repeat(64) }],
  ])(
    'rejects an idempotency-key conflict for a different %s',
    async (_label, change) => {
      optional.mockResolvedValue(undefined);
      transactionOne.mockImplementationOnce((_sql, values = []) => {
        const insertValues = optional.mock.calls[0][1] ?? [];
        return Promise.resolve({
          ...requestRow,
          idempotency_key: values[0],
          request_hash: insertValues[3],
          ...change,
        });
      });

      await expect(history.reserve(reserveInput)).rejects.toBeInstanceOf(
        VerifyEtIdempotencyConflictError,
      );
    },
  );

  it('rejects invalid idempotency keys and operations before database access', () => {
    expect(() =>
      history.reserve({ ...reserveInput, idempotencyKey: 'short' }),
    ).toThrow('idempotency key is invalid');
    expect(() =>
      history.reserve({ ...reserveInput, operation: 'DELETE' as never }),
    ).toThrow('operation is invalid');
    expect(transaction).not.toHaveBeenCalled();
  });

  it('marks reserved, sent or failed records as sent and increments attempts', async () => {
    one.mockResolvedValue({
      ...requestRow,
      request_status: 'SENT',
      attempt_count: 1,
      sent_at: createdAt,
    });

    await expect(history.markSent(requestRow.id)).resolves.toMatchObject({
      status: 'SENT',
      attemptCount: 1,
      sentAt: createdAt,
    });
    expect(one.mock.calls[0][0]).toContain(
      "request_status IN ('RESERVED','SENT','FAILED')",
    );
    expect(one.mock.calls[0][0]).toContain('completed_at = NULL');
  });

  it('atomically records sanitized response metadata and completes the request', async () => {
    transactionOne
      .mockResolvedValueOnce({
        id: 'response-record-id',
        provider_request_record_id: requestRow.id,
        http_status: 200,
        provider_status: 'VERIFIED',
        response_hash: 'c'.repeat(64),
        error_code: null,
        received_at: createdAt,
      })
      .mockResolvedValueOnce({
        ...requestRow,
        request_status: 'SUCCEEDED',
      });
    const responsePayload = { status: 'VERIFIED', privateData: 'do-not-store' };

    await expect(
      history.complete({
        requestRecordId: requestRow.id,
        httpStatus: 200,
        responsePayload,
        providerStatus: 'VERIFIED',
        providerRequestId: 'provider-request-id',
        succeeded: true,
      }),
    ).resolves.toMatchObject({ id: 'response-record-id', httpStatus: 200 });

    const responseValues = transactionOne.mock.calls[0][1] ?? [];
    expect(responseValues[3]).toMatch(/^[a-f0-9]{64}$/u);
    expect(JSON.stringify(responseValues)).not.toContain('do-not-store');
    expect(transactionOne.mock.calls[1][0]).toContain(
      'provider_request_id IS NULL OR $3 IS NULL OR provider_request_id = $3',
    );
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid provider HTTP status before database access', () => {
    expect(() =>
      history.complete({
        requestRecordId: requestRow.id,
        httpStatus: 99,
        responsePayload: {},
        succeeded: false,
      }),
    ).toThrow('response status is invalid');
    expect(transaction).not.toHaveBeenCalled();
  });
});
