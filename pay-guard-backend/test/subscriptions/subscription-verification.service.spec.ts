import {
  ForbiddenException, ServiceUnavailableException, UnprocessableEntityException,
} from '@nestjs/common';
import { V2AuditService } from '../../src/audit/v2-audit.service';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import {
  SubscriptionProofMatchError, SubscriptionVerificationDao,
} from '../../src/subscriptions/subscription-verification.dao';
import { SubscriptionVerificationService } from '../../src/subscriptions/subscription-verification.service';

describe('SubscriptionVerificationService', () => {
  const boundary = {} as DaoTransaction;
  const transaction = jest.fn((work: (value: DaoTransaction) => Promise<unknown>) =>
    work(boundary));
  const prepareWithin = jest.fn();
  const recordOutcomeWithin = jest.fn();
  const recordWithin = jest.fn();
  const verify = jest.fn();
  const service = new SubscriptionVerificationService(
    { transaction } as unknown as CentralDao,
    { prepareWithin, recordOutcomeWithin } as unknown as SubscriptionVerificationDao,
    { recordWithin } as unknown as V2AuditService,
    { verify },
  );
  const actor: AuthenticatedPrincipal = {
    userId: 'user-id', sessionId: 'session-id', role: 'PRIMARY_OWNER',
    businessIds: ['business-id'], identityType: 'BUSINESS_USER',
    membershipId: 'membership-id', membershipRoleId: 'role-id',
  };

  beforeEach(() => jest.clearAllMocks());

  it('calls Verify.ET only after matching and returns the atomic credit grant', async () => {
    prepareWithin.mockResolvedValue({
      verification: { id: 'verification-id' },
      credit: { decision: 'CHARGED', creditConsumed: true, replayed: false },
      request: { bankCode: 'CBE', transactionReference: 'FT-1',
        amount: '8000.00', receiverAccountSuffix: '12345678' },
    });
    const provider = {
      result: 'VERIFIED' as const, httpStatus: 200, providerRequestId: 'provider-1',
      providerStatus: 'VERIFIED', requestedAt: new Date('2026-08-09T10:00:00Z'),
      respondedAt: new Date('2026-08-09T10:00:01Z'), providerBankId: 'CBE',
      transactionReference: 'FT-1', amount: '8000.00',
      receiverAccountSuffix: '12345678',
      providerTransactionAt: new Date('2026-08-09T09:59:00Z'),
    };
    verify.mockResolvedValue(provider);
    recordOutcomeWithin.mockResolvedValue({ decision: 'VERIFIED', replayed: false,
      grant: { creditsGranted: 10000, balanceAfter: 10009 } });

    await expect(service.verify('business-id', 'branch-id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor)).resolves.toMatchObject({
      decision: 'VERIFIED', grant: { creditsGranted: 10000 },
      creditPreparation: { decision: 'CHARGED' },
    });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({
      bankCode: 'CBE', transactionReference: 'FT-1', amount: '8000.00',
      receiverAccountSuffix: '12345678',
    }));
    expect(recordOutcomeWithin).toHaveBeenCalledWith(boundary,
      expect.objectContaining({ provider }));
  });

  it('never contacts the provider when proof matching fails', async () => {
    prepareWithin.mockRejectedValue(new SubscriptionProofMatchError());
    await expect(service.verify('business-id', 'branch-id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor))
      .rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps the prepared attempt retryable when the provider is unavailable', async () => {
    prepareWithin.mockResolvedValue({
      verification: { id: 'verification-id' },
      credit: { decision: 'DEFERRED', creditConsumed: false, replayed: false },
      request: { bankCode: 'CBE', transactionReference: 'FT-1',
        amount: '8000.00', receiverAccountSuffix: '12345678' },
    });
    verify.mockRejectedValue(new Error('network unavailable'));
    await expect(service.verify('business-id', 'branch-id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', actor))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(recordOutcomeWithin).not.toHaveBeenCalled();
  });

  it('requires an exact Owner business context', async () => {
    await expect(service.verify('business-id', 'branch-id',
      'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', { ...actor, role: 'MANAGER' }))
      .rejects.toBeInstanceOf(ForbiddenException);
    expect(transaction).not.toHaveBeenCalled();
  });
});
