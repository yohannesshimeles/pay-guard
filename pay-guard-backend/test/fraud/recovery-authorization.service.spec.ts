import { ForbiddenException } from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  RecoveryAuthorizationDao, RecoveryAuthorizationInvalidError,
} from '../../src/fraud/recovery-authorization.dao';
import { RecoveryAuthorizationService } from '../../src/fraud/recovery-authorization.service';

describe('RecoveryAuthorizationService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary));
  const issueWithin = jest.fn();
  const revokeWithin = jest.fn();
  const redeemWithin = jest.fn();
  const recordWithin = jest.fn();
  const service = new RecoveryAuthorizationService(
    { transaction } as unknown as CentralDao,
    { issueWithin, revokeWithin, redeemWithin } as unknown as RecoveryAuthorizationDao,
    { recordWithin } as unknown as V2AuditService,
  );
  const admin: AuthenticatedPrincipal = {
    userId: 'admin-id', sessionId: 'admin-session',
    role: 'PLATFORM_SUPER_ADMIN', businessIds: [], identityType: 'PLATFORM_ADMIN',
  };
  const owner: AuthenticatedPrincipal = {
    userId: 'owner-id', sessionId: 'owner-session', role: 'PRIMARY_OWNER',
    businessIds: ['business-id'], identityType: 'BUSINESS_USER',
    membershipId: 'membership-id', membershipRoleId: 'role-id',
  };
  const recovery = {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    requestKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    businessId: 'business-id', purchaseLockId: 'lock-id',
    deliveredToUserId: 'owner-id', status: 'ACTIVE',
    expiresAt: new Date('2026-08-12T12:15:00Z'),
  };

  beforeEach(() => jest.clearAllMocks());

  it('issues a random plaintext code once but audits no secret or hash', async () => {
    issueWithin.mockResolvedValue(recovery);
    const result = await service.issue('fraud-id', {
      requestKey: recovery.requestKey, deliveredToUserId: 'owner-id',
      reviewNote: 'Identity and supporting evidence reviewed', expiresInMinutes: 15,
    }, admin);
    expect(result.authorizationCode).toMatch(/^PGRC-[A-Za-z0-9_-]{32}$/u);
    const issueInput = (issueWithin.mock.calls[0] as unknown as [
      DaoTransaction, { codeHash: string },
    ])[1];
    expect(issueInput.codeHash).toMatch(/^[a-f0-9]{64}$/u);
    const auditInput = (recordWithin.mock.calls[0] as unknown as [
      DaoTransaction, Record<string, unknown>,
    ])[1];
    expect(JSON.stringify(auditInput)).not.toContain(result.authorizationCode);
    expect(JSON.stringify(auditInput)).not.toContain(issueInput.codeHash);
  });

  it('requires the separate platform identity for issuance', async () => {
    await expect(service.issue('fraud-id', {
      requestKey: recovery.requestKey, deliveredToUserId: 'owner-id',
      reviewNote: 'Identity and supporting evidence reviewed', expiresInMinutes: 15,
    }, { ...admin, identityType: 'BUSINESS_USER' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(issueWithin).not.toHaveBeenCalled();
  });

  it('maps invalid, expired, revoked or used redemption to one generic conflict', async () => {
    redeemWithin.mockRejectedValue(new RecoveryAuthorizationInvalidError());
    await expect(service.redeem('business-id', {
      authorizationCode: 'PGRC-invalid-but-long-enough-code',
    }, owner)).rejects.toMatchObject({
      status: 409, message: 'Recovery authorization is invalid or unavailable',
    });
  });

  it('requires an exact Owner business context for redemption', async () => {
    await expect(service.redeem('business-id', {
      authorizationCode: 'PGRC-invalid-but-long-enough-code',
    }, { ...owner, role: 'MANAGER' })).rejects.toBeInstanceOf(ForbiddenException);
    expect(redeemWithin).not.toHaveBeenCalled();
  });
});
