import { DaoTransaction } from '../../src/database/central.dao';
import { NotificationAudienceDao } from '../../src/notifications/notification-audience.dao';

describe('NotificationAudienceDao', () => {
  const execute = jest.fn().mockResolvedValue(1);
  const transaction = { execute } as unknown as DaoTransaction;
  const audience = new NotificationAudienceDao();

  beforeEach(() => jest.clearAllMocks());

  it('targets a transaction update only through the immutable submitter id', async () => {
    await audience.notifyTransactionSubmitterWithin(transaction, {
      transactionId: 'transaction-id', status: 'PENDING',
    });
    const [sql, values] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('submitted.submitted_by_user_id');
    expect(sql).toContain("preference.notification_type = 'TRANSACTION_UPDATE'");
    expect(sql).toContain('ON CONFLICT (idempotency_key)');
    expect(values).toEqual(['transaction-id', 'PENDING']);
  });

  it('limits credit alerts to active owner or manager assignments covering the branch', async () => {
    await audience.notifyCreditThresholdsWithin(transaction, 'event-id');
    const [sql, values] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER','MANAGER')");
    expect(sql).toContain("assignment.status = 'ACTIVE'");
    expect(sql).toContain('assignment.branch_id = alert.branch_id');
    expect(sql).not.toContain("'CASHIER'");
    expect(sql).not.toContain("'WAITER'");
    expect(values).toEqual(['event-id']);
  });

  it('limits provider incidents to active platform administrators', async () => {
    await audience.notifyProviderIncidentWithin(transaction, {
      alertId: 'alert-id', errorCode: 'PROVIDER_UNAVAILABLE',
    });
    const [sql, values] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("admin.status = 'ACTIVE'");
    expect(sql).toContain('recipient_platform_admin_id');
    expect(sql).toContain("preference.notification_type = 'INCIDENT_ALERT'");
    expect(values).toEqual(['alert-id', 'PROVIDER_UNAVAILABLE']);
  });

  it('limits financial oversight events to active owners and branch-scoped managers', async () => {
    await audience.notifyFinancialOversightWithin(transaction, {
      operation: 'WITHDRAWAL', recordId: 'withdrawal-id',
      businessId: 'business-id', branchId: 'branch-id',
      excludeUserId: 'actor-id',
    });
    const [sql, values] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("role_assignment.role_code IN ('PRIMARY_OWNER','ADDITIONAL_OWNER','MANAGER')");
    expect(sql).toContain('assignment.branch_id = $4');
    expect(sql).toContain('membership.user_id <> $5');
    expect(sql).not.toContain('recipient_name');
    expect(sql).not.toContain('amount');
    expect(values).toEqual([
      'WITHDRAWAL', 'withdrawal-id', 'business-id', 'branch-id', 'actor-id',
    ]);
  });

  it('returns reconciliation decisions only to the immutable submitting role owner', async () => {
    await audience.notifyReconciliationSubmitterWithin(transaction, {
      reconciliationId: 'reconciliation-id', status: 'RETURNED',
    });
    const [sql, values] = execute.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('reconciliation.submitted_by_role_assignment_id');
    expect(sql).toContain("preference.notification_type = 'RECONCILIATION_EVENT'");
    expect(sql).not.toContain('decision_reason');
    expect(values).toEqual(['reconciliation-id', 'RETURNED']);
  });
});
