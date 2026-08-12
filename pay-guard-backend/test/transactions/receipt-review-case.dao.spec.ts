import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { ReceiptReviewCaseDao } from '../../src/transactions/receipt-review-case.dao';

describe('ReceiptReviewCaseDao', () => {
  const many = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const optional = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const one = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const execute = jest.fn<
    Promise<number>, [text: string, values?: readonly unknown[]]
  >();
  const dao = new ReceiptReviewCaseDao({ many, one } as unknown as CentralDao);
  const transaction = { optional, one, execute } as unknown as DaoTransaction;
  const createdAt = new Date('2026-08-08T12:00:00.000Z');
  const row = {
    id: 'case-id', transaction_id: 'transaction-id', branch_id: 'branch-id',
    transaction_reference: 'REF-001', amount: '125.50',
    transaction_date: '2026-08-08', receipt_id: 'receipt-id',
    file_name: 'receipt.png', mime_type: 'image/png', file_size_bytes: '128',
    reason_code: 'NO_QR', status: 'OPEN', acknowledged_at: null,
    acknowledged_by_user_id: null, acknowledgement_note: null,
    resolved_at: null, resolved_by_user_id: null, resolution_code: null,
    resolution_note: null, created_at: createdAt,
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists bounded receipt-safe metadata with business and branch predicates', async () => {
    many.mockResolvedValueOnce([row]);
    await expect(
      dao.list(
        { businessId: 'business-id', branchId: 'branch-id' },
        { status: 'OPEN', limit: 25, offset: 0 },
      ),
    ).resolves.toEqual([
      expect.objectContaining({
        id: 'case-id', reasonCode: 'NO_QR',
        receipt: { id: 'receipt-id', fileName: 'receipt.png',
          mimeType: 'image/png', fileSizeBytes: 128 },
      }),
    ]);
    expect(many.mock.calls[0][1]).toEqual([
      'business-id', 'branch-id', 'OPEN', null, 25, 0,
    ]);
    expect(many.mock.calls[0][0]).not.toContain('storage_object_key');
    expect(many.mock.calls[0][0]).not.toContain('file_hash');
  });

  it('acknowledges under scope lock and appends immutable history', async () => {
    optional.mockResolvedValueOnce(row);
    one.mockResolvedValueOnce({
      ...row, status: 'ACKNOWLEDGED', acknowledged_at: createdAt,
      acknowledged_by_user_id: 'manager-id', acknowledgement_note: 'Investigating',
    });
    execute.mockResolvedValueOnce(1);
    await expect(
      dao.acknowledgeWithin(transaction, {
        id: 'case-id', scope: { businessId: 'business-id', branchId: 'branch-id' },
        actorId: 'manager-id', note: '  Investigating  ',
      }),
    ).resolves.toMatchObject({ status: 'ACKNOWLEDGED' });
    expect(optional.mock.calls[0][0]).toContain('FOR UPDATE OF review_case');
    expect(execute.mock.calls[0][0]).toContain('receipt_review_case_history');
  });

  it('returns chronological scoped lifecycle history', async () => {
    many.mockResolvedValueOnce([
      {
        id: 'history-id', from_status: null, to_status: 'OPEN',
        action_by_user_id: null, note: null, resolution_code: null,
        created_at: createdAt,
      },
    ]);
    await expect(
      dao.history(
        { businessId: 'business-id', branchId: 'branch-id' }, 'case-id',
      ),
    ).resolves.toEqual([
      expect.objectContaining({ id: 'history-id', toStatus: 'OPEN' }),
    ]);
    expect(many.mock.calls[0][1]).toEqual([
      'case-id', 'business-id', 'branch-id',
    ]);
    expect(many.mock.calls[0][0]).toContain('ORDER BY history.created_at');
  });

  it('summarizes active cases against a bounded SLA without financial joins', async () => {
    one.mockResolvedValueOnce({
      total_active: '3', open_count: '2', acknowledged_count: '1',
      within_sla: '2', overdue: '1', oldest_active_created_at: createdAt,
      oldest_active_age_hours: '30.5',
    });
    await expect(
      dao.ageingSummary(
        { businessId: 'business-id' }, { slaHours: 24 },
      ),
    ).resolves.toMatchObject({
      slaHours: 24, totalActive: 3, open: 2, acknowledged: 1,
      withinSla: 2, overdue: 1, oldestActiveAgeHours: 30.5,
    });
    expect(one.mock.calls[0][1]).toEqual([
      'business-id', null, null, 24,
    ]);
    expect(one.mock.calls[0][0]).not.toContain('ledger_entries');
  });

  it('resolves only an acknowledged case without touching financial tables', async () => {
    optional.mockResolvedValueOnce({
      ...row, status: 'ACKNOWLEDGED', acknowledged_at: createdAt,
      acknowledged_by_user_id: 'manager-id', acknowledgement_note: 'Investigating',
    });
    one.mockResolvedValueOnce({
      ...row, status: 'RESOLVED', acknowledged_at: createdAt,
      acknowledged_by_user_id: 'manager-id', acknowledgement_note: 'Investigating',
      resolved_at: createdAt, resolved_by_user_id: 'manager-id',
      resolution_code: 'INVALID_RECEIPT', resolution_note: 'Rejected',
    });
    execute.mockResolvedValueOnce(1);
    await dao.resolveWithin(transaction, {
      id: 'case-id', scope: { businessId: 'business-id' }, actorId: 'manager-id',
      resolutionCode: 'INVALID_RECEIPT', note: 'Rejected',
    });
    const sql = one.mock.calls[0][0];
    expect(sql).not.toContain('customer_transactions SET');
    expect(sql).not.toContain('ledger_entries');
  });
});
