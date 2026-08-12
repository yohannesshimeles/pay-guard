import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  VerifyEtIncidentAcknowledgementConflictError,
  VerifyEtIncidentDao,
  VerifyEtIncidentNotFoundError,
} from '../../src/verify-et/verify-et-incident.dao';

describe('VerifyEtIncidentDao', () => {
  const many = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const optional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transactionOne = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transactionOptional = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const dao = new VerifyEtIncidentDao({
    many,
    optional,
  } as unknown as CentralDao);
  const transaction = {
    one: transactionOne,
    optional: transactionOptional,
  } as unknown as DaoTransaction;
  const createdAt = new Date('2026-08-06T12:00:00.000Z');
  const row = {
    id: 'incident-id',
    alert_key: 'verifyet:provider:AUTHENTICATION_FAILED:request-id',
    severity: 'CRITICAL',
    error_code: 'AUTHENTICATION_FAILED',
    provider_request_record_id: 'request-id',
    transaction_id: 'transaction-id',
    created_at: createdAt,
    acknowledged_at: null,
    acknowledged_by_platform_admin_id: null,
    acknowledgement_note: null,
  };

  beforeEach(() => jest.clearAllMocks());

  it('lists only sanitized Verify.ET incidents with bounded filters', async () => {
    many.mockResolvedValueOnce([row]);
    await expect(
      dao.list({ severity: 'CRITICAL', status: 'OPEN', limit: 25, offset: 0 }),
    ).resolves.toEqual([
      {
        id: 'incident-id',
        severity: 'CRITICAL',
        errorCode: 'AUTHENTICATION_FAILED',
        providerRequestRecordId: 'request-id',
        transactionId: 'transaction-id',
        status: 'OPEN',
        createdAt,
      },
    ]);
    expect(many.mock.calls[0][0]).toContain(
      "alert.alert_type = 'VERIFYET_PROVIDER_FAILURE'",
    );
    expect(many.mock.calls[0][1]).toEqual(['CRITICAL', 'OPEN', 25, 0]);
  });

  it('returns not found without exposing other security-alert types', async () => {
    optional.mockResolvedValueOnce(undefined);
    await expect(dao.require('incident-id')).rejects.toBeInstanceOf(
      VerifyEtIncidentNotFoundError,
    );
  });

  it('acknowledges under a row lock and returns sanitized metadata', async () => {
    transactionOptional.mockResolvedValueOnce(row);
    transactionOne.mockResolvedValueOnce({
      ...row,
      acknowledged_at: createdAt,
      acknowledged_by_platform_admin_id: 'admin-id',
      acknowledgement_note: 'Investigating credential rotation',
    });
    await expect(
      dao.acknowledgeWithin(transaction, {
        id: 'incident-id',
        platformAdminId: 'admin-id',
        note: '  Investigating credential rotation  ',
      }),
    ).resolves.toMatchObject({
      status: 'ACKNOWLEDGED',
      acknowledgedByPlatformAdminId: 'admin-id',
      acknowledgementNote: 'Investigating credential rotation',
    });
    expect(transactionOptional.mock.calls[0][0]).toContain(
      'FOR UPDATE OF alert',
    );
    expect(transactionOne.mock.calls[0][1]).toEqual([
      'incident-id',
      'admin-id',
      'Investigating credential rotation',
    ]);
  });

  it('allows exact replay but rejects a changed acknowledgement', async () => {
    transactionOptional.mockResolvedValue({
      ...row,
      acknowledged_at: createdAt,
      acknowledged_by_platform_admin_id: 'admin-id',
      acknowledgement_note: 'Known incident',
    });
    await expect(
      dao.acknowledgeWithin(transaction, {
        id: 'incident-id',
        platformAdminId: 'admin-id',
        note: 'Known incident',
      }),
    ).resolves.toMatchObject({ status: 'ACKNOWLEDGED' });
    await expect(
      dao.acknowledgeWithin(transaction, {
        id: 'incident-id',
        platformAdminId: 'admin-id',
        note: 'Changed note',
      }),
    ).rejects.toBeInstanceOf(VerifyEtIncidentAcknowledgementConflictError);
    expect(transactionOne).not.toHaveBeenCalled();
  });
});
