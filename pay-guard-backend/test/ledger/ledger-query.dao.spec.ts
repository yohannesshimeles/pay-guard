import { CentralDao } from '../../src/database/central.dao';
import { LedgerEntryType } from '../../src/ledger/ledger-entry-type.enum';
import { LedgerQueryDao } from '../../src/ledger/ledger-query.dao';

describe('LedgerQueryDao', () => {
  const many = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const optional = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const dao = new LedgerQueryDao({ many, optional } as unknown as CentralDao);
  const createdAt = new Date('2026-08-09T12:00:00.000Z');
  const row = {
    id: 'entry-id', business_id: 'business-id', branch_id: 'branch-id',
    settlement_account_id: 'account-id', entry_type: 'MANUAL_DEPOSIT',
    direction: 'CREDIT', amount: '25.00', running_balance: '125.00',
    actual_transaction_at: createdAt, description: 'Cash deposit',
    created_by_user_id: 'cashier-id', reversal_of_entry_id: null,
    created_at: createdAt,
  };

  beforeEach(() => jest.clearAllMocks());

  it('applies business, branch, account, type, date and bounded page predicates', async () => {
    many.mockResolvedValueOnce([row]);
    await expect(dao.list(
      { businessId: 'business-id', branchId: 'branch-id' },
      {
        settlementAccountId: 'account-id',
        entryType: LedgerEntryType.MANUAL_DEPOSIT,
        dateFrom: '2026-08-01', dateTo: '2026-08-09', limit: 25, offset: 0,
      },
    )).resolves.toEqual([
      expect.objectContaining({
        id: 'entry-id', direction: 'CREDIT', runningBalance: '125.00',
      }),
    ]);
    expect(many.mock.calls[0][1]).toEqual([
      'business-id', 'branch-id', 'account-id', 'MANUAL_DEPOSIT',
      '2026-08-01', '2026-08-09', 25, 0,
    ]);
  });

  it('returns safe entry detail without internal linkage metadata', async () => {
    optional.mockResolvedValueOnce(row);
    await expect(dao.find('entry-id', {
      businessId: 'business-id', branchId: 'branch-id',
    })).resolves.toMatchObject({ id: 'entry-id', amount: '25.00' });
    const sql = optional.mock.calls[0][0];
    expect(sql).not.toContain('idempotency_key');
    expect(sql).not.toContain('audit_log_id');
    expect(sql).not.toContain('source_record_id');
  });

  it('calculates a read-only debit projection within account scope', async () => {
    optional.mockResolvedValueOnce({
      settlement_account_id: 'account-id', branch_id: 'branch-id',
      current_balance: '125.00', projected_balance: '115.00',
    });
    await expect(dao.projectedBalance(
      'account-id', { businessId: 'business-id', branchId: 'branch-id' },
      { direction: 'DEBIT', amount: '10.00' },
    )).resolves.toEqual({
      settlementAccountId: 'account-id', branchId: 'branch-id', currency: 'ETB',
      direction: 'DEBIT', amount: '10.00', currentBalance: '125.00',
      projectedBalance: '115.00',
    });
    expect(optional.mock.calls[0][1]).toEqual([
      'account-id', 'business-id', 'branch-id', 'DEBIT', '10.00',
    ]);
    expect(optional.mock.calls[0][0]).not.toContain('UPDATE');
  });
});
