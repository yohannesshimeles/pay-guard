import { CentralDao } from '../../src/database/central.dao';
import { CustomerTransactionStatus } from '../../src/verifications/enums/customer-transaction-status.enum';
import { TransactionQueryDao } from '../../src/transactions/transaction-query.dao';

describe('TransactionQueryDao', () => {
  const many = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const dao = new TransactionQueryDao({
    many,
    optional,
  } as unknown as CentralDao);
  const createdAt = new Date('2026-08-06T15:00:00.000Z');
  const row = {
    id: 'transaction-id',
    business_id: 'business-id',
    branch_id: 'branch-id',
    submitted_by_user_id: 'waiter-id',
    bank_id: 'bank-id',
    transaction_reference: 'REF-001',
    amount: '125.00',
    transaction_date: '2026-08-06',
    transaction_time: '15:00:00',
    masked_receiver_account: '****4321',
    submission_method: 'QR_SCAN',
    current_status: CustomerTransactionStatus.VERIFIED,
    failure_reason: null,
    finalized_at: createdAt,
    created_at: createdAt,
    receipt_count: '1',
    confirmed: true,
    financially_posted: true,
  };

  beforeEach(() => jest.clearAllMocks());

  it('applies tenant, branch and Waiter predicates to bounded list queries', async () => {
    many.mockResolvedValueOnce([row]);
    await expect(
      dao.list(
        {
          businessId: 'business-id',
          branchId: 'branch-id',
          submittedByUserId: 'waiter-id',
        },
        {
          status: CustomerTransactionStatus.VERIFIED,
          limit: 25,
          offset: 0,
        },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'transaction-id',
        amount: '125.00',
        hasReceipt: true,
        confirmed: true,
        financiallyPosted: true,
      }),
    ]);
    expect(many.mock.calls[0][1]).toEqual([
      'business-id',
      'branch-id',
      'waiter-id',
      CustomerTransactionStatus.VERIFIED,
      null,
      null,
      null,
      25,
      0,
    ]);
  });

  it('selects only sanitized receipt and provider metadata', async () => {
    optional.mockResolvedValueOnce(row);
    await dao.find('transaction-id', { businessId: 'business-id' });
    const sql = optional.mock.calls[0][0];
    expect(sql).toContain('masked_receiver_account');
    expect(sql).toContain('receipt_count');
    expect(sql).not.toContain('storage_object_key');
    expect(sql).not.toContain('file_hash');
    expect(sql).not.toContain('provider_response_snapshot');
    expect(sql).not.toContain('verifyet_request_id');
  });

  it('checks scoped visibility before returning sanitized history', async () => {
    optional.mockResolvedValueOnce(row);
    many.mockResolvedValueOnce([
      {
        id: 'history-id',
        from_status: 'PROCESSING',
        to_status: 'VERIFIED',
        reason: 'Matched',
        transition_source: 'VERIFYET',
        created_at: createdAt,
      },
    ]);
    await expect(
      dao.history('transaction-id', {
        businessId: 'business-id',
        submittedByUserId: 'waiter-id',
      }),
    ).resolves.toEqual([
      {
        id: 'history-id',
        fromStatus: 'PROCESSING',
        toStatus: 'VERIFIED',
        reason: 'Matched',
        transitionSource: 'VERIFYET',
        createdAt,
      },
    ]);
    expect(optional.mock.calls[0][1]).toEqual([
      'transaction-id',
      'business-id',
      null,
      'waiter-id',
    ]);
  });

  it('returns sanitized verification outcomes after scoped visibility', async () => {
    optional.mockResolvedValueOnce(row);
    many.mockResolvedValueOnce([
      {
        id: 'attempt-id', attempt_type: 'INITIAL', attempt_number: 1,
        result_status: 'FAILED', requested_at: createdAt,
        responded_at: createdAt, response_time_ms: 20, created_at: createdAt,
      },
    ]);
    await expect(
      dao.verificationOutcomes('transaction-id', {
        businessId: 'business-id', branchId: 'branch-id',
      }),
    ).resolves.toEqual([
      {
        id: 'attempt-id', attemptType: 'INITIAL', attemptNumber: 1,
        outcome: 'FAILED', requestedAt: createdAt, respondedAt: createdAt,
        responseTimeMs: 20, failureCategory: 'VERIFICATION_FAILED',
        createdAt,
      },
    ]);
    const sql = many.mock.calls[0][0];
    expect(sql).not.toContain('attempt_key');
    expect(sql).not.toContain('provider_request_id');
    expect(sql).not.toContain('provider_status');
    expect(sql).not.toContain('credit_transaction_id');
    expect(sql).not.toContain('error_code');
  });

  it('returns sanitized receipt decisions only after scoped visibility', async () => {
    optional.mockResolvedValueOnce(row);
    many.mockResolvedValueOnce([
      {
        id: 'decision-id',
        receipt_id: 'receipt-id',
        decision: 'REVIEW_REQUIRED',
        reason_code: 'AMOUNT_MISMATCH',
        created_at: createdAt,
      },
    ]);
    await expect(
      dao.receiptDecisions('transaction-id', {
        businessId: 'business-id',
        submittedByUserId: 'waiter-id',
      }),
    ).resolves.toEqual([
      {
        id: 'decision-id',
        receiptId: 'receipt-id',
        decision: 'REVIEW_REQUIRED',
        reasonCode: 'AMOUNT_MISMATCH',
        createdAt,
      },
    ]);
    expect(many.mock.calls[0][0]).not.toContain('storage_object_key');
    expect(many.mock.calls[0][0]).not.toContain('file_hash');
  });

  it('aggregates role-scoped operational review counts', async () => {
    many.mockResolvedValueOnce([
      { decision: 'MATCHED', reason_code: null, decision_count: '3' },
      {
        decision: 'REVIEW_REQUIRED',
        reason_code: 'NO_QR',
        decision_count: '2',
      },
      {
        decision: 'REVIEW_REQUIRED',
        reason_code: 'AMOUNT_MISMATCH',
        decision_count: '1',
      },
    ]);
    await expect(
      dao.receiptReviewSummary(
        {
          businessId: 'business-id',
          branchId: 'branch-id',
          submittedByUserId: 'waiter-id',
        },
        { dateFrom: '2026-08-01', dateTo: '2026-08-08' },
      ),
    ).resolves.toEqual({
      total: 6,
      matched: 3,
      reviewRequired: 3,
      reasons: { NO_QR: 2, AMOUNT_MISMATCH: 1 },
    });
    expect(many.mock.calls[0][1]).toEqual([
      'business-id',
      'branch-id',
      'waiter-id',
      '2026-08-01',
      '2026-08-08',
    ]);
  });
});
