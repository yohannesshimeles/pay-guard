import { CentralDao } from '../../src/database/central.dao';
import { OperationalReportDao } from '../../src/reports/operational-report.dao';

describe('OperationalReportDao', () => {
  const one = jest.fn<Promise<unknown>, [text: string, values?: readonly unknown[]]>();
  const reports = new OperationalReportDao({ one } as unknown as CentralDao);

  beforeEach(() => jest.clearAllMocks());

  it('aggregates business operations without provider payloads', async () => {
    one.mockResolvedValueOnce({
      verification_statuses: [{ status: 'VERIFIED', count: 2 }],
      purchased_credits: '10000', used_credits: '2', expired_credits: '0',
      available_credits: '9998',
      subscription_statuses: [{ status: 'ACTIVE', count: 1 }],
      invoice_count: '1', invoiced_total: '8000.00', fraud_attempt_count: '1',
      open_fraud_flag_count: '1', active_purchase_lock_count: '0',
    });
    const result = await reports.businessSummary(
      { businessId: 'business-id', branchId: 'branch-id' },
      { dateFrom: '2026-08-01', dateTo: '2026-08-13' },
    );
    expect(result).toMatchObject({
      credits: { purchased: '10000', available: '9998' },
      subscriptions: { invoiceCount: 1, invoicedTotal: '8000.00' },
      fraud: { attemptCount: 1, openFlagCount: 1 },
    });
    expect(one.mock.calls[0][1]).toEqual([
      'business-id', 'branch-id', '2026-08-01', '2026-08-13',
    ]);
    const sql = one.mock.calls[0][0];
    expect(sql).toContain('attempt.business_id = $1');
    expect(sql).toContain('transaction.branch_id = $2');
    expect(sql).not.toContain('provider_response_snapshot');
    expect(sql).not.toContain('transaction_reference');
  });

  it('returns sanitized global provider health aggregates', async () => {
    one.mockResolvedValueOnce({
      request_statuses: [{ status: 'SUCCEEDED', count: 3 }],
      operations: [{ operation: 'SUBMIT', count: 3 }],
      response_classes: [{ responseClass: '2xx', count: 3 }],
      average_response_ms: '125.50', open_incident_count: '1',
      acknowledged_incident_count: '2',
    });
    await expect(reports.providerSummary({
      dateFrom: '2026-08-01', dateTo: '2026-08-13',
    })).resolves.toMatchObject({
      responses: { averageResponseMs: '125.50' },
      incidents: { open: 1, acknowledged: 2 },
    });
    expect(one.mock.calls[0][1]).toEqual(['2026-08-01', '2026-08-13']);
    const sql = one.mock.calls[0][0];
    expect(sql).not.toContain('request_hash');
    expect(sql).not.toContain('response_hash');
    expect(sql).not.toContain('details_json->');
  });
});
