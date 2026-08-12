import { DaoTransaction } from '../../src/database/central.dao';
import {
  LedgerDao,
  LedgerPostingConflictError,
} from '../../src/ledger/ledger.dao';
import { LedgerEntryType } from '../../src/ledger/ledger-entry-type.enum';

describe('LedgerDao', () => {
  const optional = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const one = jest.fn<
    Promise<unknown>, [text: string, values?: readonly unknown[]]
  >();
  const transaction = { optional, one } as unknown as DaoTransaction;
  const dao = new LedgerDao();
  const timestamp = new Date('2026-08-09T10:00:00.000Z');
  const account = {
    id: 'account-id', business_id: 'business-id', branch_id: 'branch-id',
    calculated_balance: '100.00',
  };
  const input = {
    businessId: 'business-id', branchId: 'branch-id',
    settlementAccountId: 'account-id',
    entryType: LedgerEntryType.MANUAL_DEPOSIT,
    amount: '25.50', actualTransactionAt: timestamp,
    sourceRecordType: 'MANUAL_DEPOSIT', sourceRecordId: 'source-id',
    description: 'Cash deposit', createdByUserId: 'user-id',
    workAssignmentId: 'assignment-id', auditLogId: 'audit-id',
    idempotencyKey: 'ledger:manual:source-id',
  } as const;
  const row = {
    id: 'entry-id', business_id: 'business-id', branch_id: 'branch-id',
    settlement_account_id: 'account-id', entry_type: 'MANUAL_DEPOSIT',
    direction: 'CREDIT', amount: '25.50', running_balance: '125.50',
    actual_transaction_at: timestamp, source_record_type: 'MANUAL_DEPOSIT',
    source_record_id: 'source-id', description: 'Cash deposit',
    created_by_user_id: 'user-id', work_assignment_id: 'assignment-id',
    audit_log_id: 'audit-id', reversal_of_entry_id: null,
    idempotency_key: 'ledger:manual:source-id', created_at: timestamp,
  };

  beforeEach(() => jest.clearAllMocks());

  it('locks the account and atomically posts a credit with running balance', async () => {
    optional.mockResolvedValueOnce(account).mockResolvedValueOnce(undefined);
    one.mockResolvedValueOnce({ calculated_balance: '125.50' })
      .mockResolvedValueOnce(row);
    await expect(dao.postWithin(transaction, input)).resolves.toMatchObject({
      replayed: false,
      entry: { direction: 'CREDIT', runningBalance: '125.50' },
    });
    expect(optional.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(one.mock.calls[0][0]).toContain("WHEN $2 = 'CREDIT'");
    expect(one.mock.calls[0][1]).toEqual(['account-id', 'CREDIT', '25.50']);
  });

  it('returns an exact idempotent replay without changing the balance', async () => {
    optional.mockResolvedValueOnce(account).mockResolvedValueOnce(row);
    await expect(dao.postWithin(transaction, input)).resolves.toMatchObject({
      replayed: true, entry: { id: 'entry-id' },
    });
    expect(one).not.toHaveBeenCalled();
  });

  it('rejects a changed reuse of an idempotency key', async () => {
    optional.mockResolvedValueOnce(account).mockResolvedValueOnce(row);
    await expect(dao.postWithin(transaction, {
      ...input, amount: '26.00',
    })).rejects.toBeInstanceOf(LedgerPostingConflictError);
    expect(one).not.toHaveBeenCalled();
  });

  it('reverses the exact original amount in the opposite direction', async () => {
    optional
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(account)
      .mockResolvedValueOnce(undefined);
    one.mockResolvedValueOnce({ calculated_balance: '74.50' })
      .mockResolvedValueOnce({
        ...row, id: 'reversal-id', entry_type: 'REVERSAL', direction: 'DEBIT',
        running_balance: '74.50', source_record_type: 'BALANCE_REVERSAL',
        source_record_id: 'reversal-source', description: 'Approved reversal',
        reversal_of_entry_id: 'entry-id', idempotency_key: 'ledger:reverse:entry-id',
      });
    await expect(dao.reverseWithin(transaction, {
      businessId: 'business-id', branchId: 'branch-id',
      originalEntryId: 'entry-id', actualTransactionAt: timestamp,
      sourceRecordType: 'BALANCE_REVERSAL', sourceRecordId: 'reversal-source',
      description: 'Approved reversal', createdByUserId: 'manager-id',
      auditLogId: 'reversal-audit-id', idempotencyKey: 'ledger:reverse:entry-id',
    })).resolves.toMatchObject({
      entry: { entryType: 'REVERSAL', direction: 'DEBIT', amount: '25.50' },
    });
    expect(one.mock.calls[0][1]).toEqual(['account-id', 'DEBIT', '25.50']);
  });
});
