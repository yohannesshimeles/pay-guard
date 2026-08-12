import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { VerifyEtOperationalAlertDao } from '../../src/verify-et/verify-et-operational-alert.dao';
import { NotificationAudienceDao } from '../../src/notifications/notification-audience.dao';

describe('VerifyEtOperationalAlertDao', () => {
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transaction = jest.fn((work: (current: DaoTransaction) => Promise<unknown>) =>
    work({ one } as unknown as DaoTransaction));
  const notifyProviderIncidentWithin = jest.fn().mockResolvedValue(1);
  const alerts = new VerifyEtOperationalAlertDao({
    transaction,
  } as unknown as CentralDao, {
    notifyProviderIncidentWithin,
  } as unknown as NotificationAudienceDao);
  const createdAt = new Date('2026-08-06T12:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('creates an idempotent critical authentication alert with sanitized identifiers', async () => {
    one.mockResolvedValueOnce({
      id: 'alert-id',
      alert_key: 'verifyet:provider:AUTHENTICATION_FAILED:provider-record-id',
      severity: 'CRITICAL',
      created_at: createdAt,
    });

    await expect(
      alerts.create({
        requestRecordId: 'provider-record-id',
        transactionId: 'transaction-id',
        errorCode: 'AUTHENTICATION_FAILED',
      }),
    ).resolves.toMatchObject({
      alertType: 'VERIFYET_PROVIDER_FAILURE',
      severity: 'CRITICAL',
    });
    expect(one.mock.calls[0][0]).toContain(
      'ON CONFLICT (alert_key) WHERE alert_key IS NOT NULL',
    );
    expect(one.mock.calls[0][1]).toEqual([
      'verifyet:provider:AUTHENTICATION_FAILED:provider-record-id',
      'CRITICAL',
      'AUTHENTICATION_FAILED',
      'provider-record-id',
      'transaction-id',
    ]);
    expect(notifyProviderIncidentWithin).toHaveBeenCalledWith(
      expect.anything(),
      { alertId: 'alert-id', errorCode: 'AUTHENTICATION_FAILED' },
    );
  });

  it('uses high severity for other stopped provider failures', async () => {
    one.mockResolvedValueOnce({
      id: 'alert-id',
      alert_key: 'verifyet:provider:PROVIDER_FORBIDDEN:provider-record-id',
      severity: 'HIGH',
      created_at: createdAt,
    });
    await expect(
      alerts.create({
        requestRecordId: 'provider-record-id',
        transactionId: 'transaction-id',
        errorCode: 'PROVIDER_FORBIDDEN',
      }),
    ).resolves.toMatchObject({ severity: 'HIGH' });
  });
});
