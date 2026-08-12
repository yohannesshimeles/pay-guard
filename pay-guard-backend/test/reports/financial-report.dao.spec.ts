import { CentralDao } from '../../src/database/central.dao';
import { FinancialReportDao } from '../../src/reports/financial-report.dao';

describe('FinancialReportDao', () => {
  const one = jest.fn<Promise<unknown>, [text: string, values?: readonly unknown[]]>();
  const reports = new FinancialReportDao({ one } as unknown as CentralDao);

  beforeEach(() => jest.clearAllMocks());

  it('aggregates immutable ledger rows in exact business and branch scope', async () => {
    one.mockResolvedValueOnce({
      entry_count: '3', credit_total: '150.00', debit_total: '25.00',
      net_total: '125.00',
      categories: [
        { entryType: 'MANUAL_DEPOSIT', entryCount: 1,
          creditTotal: '50.00', debitTotal: '0', netTotal: '50.00' },
        { entryType: 'VERIFIED_DEPOSIT', entryCount: 1,
          creditTotal: '100.00', debitTotal: '0', netTotal: '100.00' },
        { entryType: 'WITHDRAWAL', entryCount: 1,
          creditTotal: '0', debitTotal: '25.00', netTotal: '-25.00' },
      ],
    });

    const result = await reports.summary(
      { businessId: 'business-id', branchId: 'branch-id' },
      { dateFrom: '2026-08-01', dateTo: '2026-08-13' },
    );
    expect(result).toMatchObject({
      entryCount: 3, creditTotal: '150.00', debitTotal: '25.00',
      netTotal: '125.00',
    });
    expect(result.categories).toContainEqual(
      expect.objectContaining({ entryType: 'MANUAL_DEPOSIT' }),
    );

    expect(one.mock.calls[0][1]).toEqual([
      'business-id', 'branch-id', null, '2026-08-01', '2026-08-13',
    ]);
    const sql = one.mock.calls[0][0];
    expect(sql).toContain('entry.business_id = $1');
    expect(sql).toContain('entry.branch_id = $2');
    expect(sql).toContain('GROUP BY entry_type');
    expect(sql).not.toContain('UPDATE ');
    expect(sql).not.toContain('DELETE ');
  });

  it('keeps Manual Deposits separate from verified deposits', async () => {
    one.mockResolvedValueOnce({
      entry_count: '2', credit_total: '150.00', debit_total: '0',
      net_total: '150.00', categories: [
        { entryType: 'MANUAL_DEPOSIT', entryCount: 1, creditTotal: '50.00',
          debitTotal: '0', netTotal: '50.00' },
        { entryType: 'VERIFIED_DEPOSIT', entryCount: 1, creditTotal: '100.00',
          debitTotal: '0', netTotal: '100.00' },
      ],
    });
    const result = await reports.summary(
      { businessId: 'business-id' },
      { dateFrom: '2026-08-01', dateTo: '2026-08-13' },
    );
    expect(result.categories.map((category) => category.entryType)).toEqual([
      'MANUAL_DEPOSIT', 'VERIFIED_DEPOSIT',
    ]);
  });
});
