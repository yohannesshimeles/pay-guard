import { ConflictException, ForbiddenException } from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  VerifyEtIncidentAcknowledgementConflictError,
  VerifyEtIncidentDao,
} from '../../src/verify-et/verify-et-incident.dao';
import { VerifyEtIncidentService } from '../../src/verify-et/verify-et-incident.service';

describe('VerifyEtIncidentService', () => {
  const list = jest.fn();
  const requireIncident = jest.fn();
  const acknowledgeWithin = jest.fn();
  const recordWithin = jest.fn();
  const transactionBoundary = {} as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work(transactionBoundary));
  const service = new VerifyEtIncidentService(
    { transaction } as unknown as CentralDao,
    {
      list,
      require: requireIncident,
      acknowledgeWithin,
    } as unknown as VerifyEtIncidentDao,
    { recordWithin } as unknown as V2AuditService,
  );
  const admin: AuthenticatedPrincipal = {
    userId: 'admin-id',
    sessionId: 'admin-session-id',
    role: 'PLATFORM_SUPER_ADMIN',
    businessIds: [],
    identityType: 'PLATFORM_ADMIN',
  };
  const incident = {
    id: 'incident-id',
    severity: 'CRITICAL',
    errorCode: 'AUTHENTICATION_FAILED',
    providerRequestRecordId: 'request-id',
    transactionId: 'transaction-id',
    status: 'ACKNOWLEDGED',
    createdAt: new Date('2026-08-06T12:00:00.000Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('rejects business identities even when a caller supplies a privileged role', () => {
    expect(() =>
      service.list(
        { limit: 50, offset: 0 },
        { ...admin, identityType: 'BUSINESS_USER' },
      ),
    ).toThrow(ForbiddenException);
    expect(list).not.toHaveBeenCalled();
  });

  it('passes only validated filters to the incident DAO', async () => {
    list.mockResolvedValueOnce([]);
    await expect(
      service.list(
        { severity: 'HIGH', status: 'OPEN', limit: 20, offset: 5 },
        admin,
      ),
    ).resolves.toEqual([]);
    expect(list).toHaveBeenCalledWith({
      severity: 'HIGH',
      status: 'OPEN',
      limit: 20,
      offset: 5,
    });
  });

  it('acknowledges and writes the platform-admin audit in one transaction', async () => {
    acknowledgeWithin.mockResolvedValueOnce(incident);
    recordWithin.mockResolvedValueOnce(undefined);
    await expect(
      service.acknowledge(
        'incident-id',
        { note: 'Credential rotation started' },
        admin,
      ),
    ).resolves.toBe(incident);
    expect(acknowledgeWithin).toHaveBeenCalledWith(transactionBoundary, {
      id: 'incident-id',
      platformAdminId: 'admin-id',
      note: 'Credential rotation started',
    });
    expect(recordWithin).toHaveBeenCalledWith(
      transactionBoundary,
      expect.objectContaining({
        actionType: 'VERIFYET_INCIDENT_ACKNOWLEDGED',
        recordId: 'incident-id',
        sessionId: 'admin-session-id',
      }),
    );
  });

  it('maps changed acknowledgement replay to a conflict response', async () => {
    acknowledgeWithin.mockRejectedValueOnce(
      new VerifyEtIncidentAcknowledgementConflictError(),
    );
    await expect(
      service.acknowledge('incident-id', {}, admin),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(recordWithin).not.toHaveBeenCalled();
  });
});
