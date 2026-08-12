import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { CustomerTransactionStatus } from '../../src/verifications/enums/customer-transaction-status.enum';
import { VerificationTransitionSource } from '../../src/verifications/enums/verification-transition-source.enum';
import { VerificationStateMachineService } from '../../src/verifications/verification-state-machine.service';
import { VerificationTransitionDao } from '../../src/verifications/verification-transition.dao';
import { NotificationAudienceDao } from '../../src/notifications/notification-audience.dao';

describe('VerificationTransitionDao', () => {
  const one = jest.fn<
    Promise<unknown>,
    [text: string, values?: readonly unknown[]]
  >();
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work({ one } as unknown as DaoTransaction));
  const centralDao = { transaction } as unknown as CentralDao;
  const notifyTransactionSubmitterWithin = jest.fn().mockResolvedValue(1);
  const transitions = new VerificationTransitionDao(
    centralDao,
    new VerificationStateMachineService(),
    { notifyTransactionSubmitterWithin } as unknown as NotificationAudienceDao,
  );
  const changedAt = new Date('2026-08-06T12:00:00.000Z');

  beforeEach(() => jest.clearAllMocks());

  it('locks, updates and records an accepted transition atomically', async () => {
    one
      .mockResolvedValueOnce({
        id: 'transaction-id',
        current_status: CustomerTransactionStatus.PROCESSING,
      })
      .mockResolvedValueOnce({
        id: 'transaction-id',
        current_status: CustomerTransactionStatus.PENDING,
      })
      .mockResolvedValueOnce({
        transaction_id: 'transaction-id',
        from_status: CustomerTransactionStatus.PROCESSING,
        to_status: CustomerTransactionStatus.PENDING,
        reason: 'PROVIDER_PENDING',
        changed_by_user_id: null,
        verification_attempt_id: 'attempt-id',
        transition_source: VerificationTransitionSource.VERIFYET,
        created_at: changedAt,
      });

    await expect(
      transitions.transition({
        transactionId: 'transaction-id',
        toStatus: CustomerTransactionStatus.PENDING,
        source: VerificationTransitionSource.VERIFYET,
        reasonCode: 'PROVIDER_PENDING',
        verificationAttemptId: 'attempt-id',
      }),
    ).resolves.toEqual({
      transactionId: 'transaction-id',
      fromStatus: CustomerTransactionStatus.PROCESSING,
      toStatus: CustomerTransactionStatus.PENDING,
      source: VerificationTransitionSource.VERIFYET,
      reasonCode: 'PROVIDER_PENDING',
      changedByUserId: undefined,
      verificationAttemptId: 'attempt-id',
      changedAt,
    });

    expect(one).toHaveBeenCalledTimes(3);
    expect(one.mock.calls[0][0]).toContain('FOR UPDATE');
    expect(one.mock.calls[1][0]).toContain(
      "IN ('VERIFIED','FAILED','DUPLICATE')",
    );
    expect(one.mock.calls[2][1]).toEqual([
      'transaction-id',
      CustomerTransactionStatus.PROCESSING,
      CustomerTransactionStatus.PENDING,
      'PROVIDER_PENDING',
      null,
      'attempt-id',
      VerificationTransitionSource.VERIFYET,
    ]);
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(notifyTransactionSubmitterWithin).toHaveBeenCalledWith(
      expect.anything(),
      { transactionId: 'transaction-id', status: CustomerTransactionStatus.PENDING },
    );
  });

  it('rejects an invalid transition before update or history insertion', async () => {
    one.mockResolvedValueOnce({
      id: 'transaction-id',
      current_status: CustomerTransactionStatus.VERIFIED,
    });

    await expect(
      transitions.transition({
        transactionId: 'transaction-id',
        toStatus: CustomerTransactionStatus.PROCESSING,
        source: VerificationTransitionSource.SYSTEM,
      }),
    ).rejects.toThrow('transition is not allowed');
    expect(one).toHaveBeenCalledTimes(1);
  });

  it('rejects unsafe reason details before opening a transaction', () => {
    expect(() =>
      transitions.transition({
        transactionId: 'transaction-id',
        toStatus: CustomerTransactionStatus.FAILED,
        source: VerificationTransitionSource.SYSTEM,
        reasonCode: 'raw failure explanation',
      }),
    ).toThrow('reason code is invalid');
    expect(transaction).not.toHaveBeenCalled();
  });
});
