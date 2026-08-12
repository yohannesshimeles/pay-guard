import { CentralDao, DaoTransaction } from '../../src/database/central.dao';
import { VerificationAttemptEntity } from '../../src/verifications/entities/verification-attempt.entity';
import { VerificationAttemptResult } from '../../src/verifications/enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../../src/verifications/enums/verification-attempt-type.enum';
import { VerificationAttemptDao } from '../../src/verifications/verification-attempt.dao';
import { VerificationTransitionDao } from '../../src/verifications/verification-transition.dao';
import { VerifiedPaymentPostingService } from '../../src/verifications/verified-payment-posting.service';
import { LedgerDao } from '../../src/ledger/ledger.dao';

describe('VerifiedPaymentPostingService', () => {
  const one = jest.fn();
  const optional = jest.fn();
  const execute = jest.fn();
  const databaseTransaction = {
    one,
    optional,
    execute,
  } as unknown as DaoTransaction;
  const transaction = jest.fn<
    Promise<unknown>,
    [(current: DaoTransaction) => Promise<unknown>]
  >((work) => work(databaseTransaction));
  const findByKeyWithin = jest.fn();
  const finalizeWithin = jest.fn();
  const transitionWithin = jest.fn();
  const postWithin = jest.fn();
  const service = new VerifiedPaymentPostingService(
    { transaction } as unknown as CentralDao,
    { findByKeyWithin, finalizeWithin } as unknown as VerificationAttemptDao,
    { transitionWithin } as unknown as VerificationTransitionDao,
    { postWithin } as unknown as LedgerDao,
  );
  const requestedAt = new Date('2026-08-06T12:00:00.000Z');
  const respondedAt = new Date('2026-08-06T12:00:01.000Z');
  const providerTransactionAt = new Date('2026-08-06T11:59:00.000Z');
  const providerBankId = '11111111-1111-4111-8111-111111111111';
  const input = {
    attemptKey: 'verification:initial:transaction-id',
    providerRequestId: 'provider-request-1',
    providerStatus: 'VERIFIED' as const,
    requestedAt,
    respondedAt,
    providerBankId,
    transactionReference: 'REFERENCE-001',
    amount: '125.50',
    receiverAccountSuffix: '1234',
    providerTransactionAt,
  };
  const queuedAttempt = new VerificationAttemptEntity({
    id: 'attempt-id',
    transactionId: 'transaction-id',
    businessId: 'business-id',
    branchId: 'branch-id',
    attemptKey: input.attemptKey,
    attemptType: VerificationAttemptType.INITIAL,
    attemptNumber: 1,
    result: VerificationAttemptResult.QUEUED,
    creditTransactionId: 'credit-id',
    createdAt: requestedAt,
  });
  const scope = {
    transaction_id: 'transaction-id',
    business_id: 'business-id',
    branch_id: 'branch-id',
    settlement_account_id: 'account-id',
    bank_id: providerBankId,
    transaction_reference: input.transactionReference,
    amount: input.amount,
    work_assignment_id: 'assignment-id',
    submitted_by_user_id: 'user-id',
    account_suffix: input.receiverAccountSuffix,
    account_status: 'ACTIVE',
    tolerance_minutes: 5,
    time_delta_seconds: 60,
  };

  function finalized(result: VerificationAttemptResult, errorCode?: string) {
    return new VerificationAttemptEntity({
      ...queuedAttempt,
      result,
      providerRequestId: input.providerRequestId,
      providerStatus: input.providerStatus,
      requestedAt,
      respondedAt,
      responseTimeMs: 1_000,
      errorCode,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findByKeyWithin.mockResolvedValue(queuedAttempt);
  });

  it('atomically confirms, credits and posts one matched payment', async () => {
    one
      .mockResolvedValueOnce(scope)
      .mockResolvedValueOnce({
        id: 'confirmation-id',
        transaction_id: 'transaction-id',
        verification_attempt_id: 'attempt-id',
      })
      .mockResolvedValueOnce({ id: 'audit-id' })
      .mockResolvedValueOnce({ id: 'transaction-id' });
    optional.mockResolvedValueOnce(undefined);
    finalizeWithin.mockResolvedValueOnce({
      attempt: finalized(VerificationAttemptResult.VERIFIED),
      replayed: false,
    });
    postWithin.mockResolvedValueOnce({
      entry: { id: 'ledger-id' }, replayed: false,
    });

    await expect(service.post(input)).resolves.toEqual({
      decision: 'VERIFIED',
      replayed: false,
      transactionId: 'transaction-id',
      confirmationId: 'confirmation-id',
      ledgerEntryId: 'ledger-id',
    });
    expect(postWithin).toHaveBeenCalledWith(
      databaseTransaction,
      expect.objectContaining({
        entryType: 'VERIFIED_DEPOSIT', amount: '125.50',
        auditLogId: 'audit-id',
        idempotencyKey: 'ledger:verified:confirmation-id',
      }),
    );
    expect(transitionWithin).toHaveBeenCalledWith(
      databaseTransaction,
      expect.objectContaining({
        toStatus: 'VERIFIED',
        reasonCode: 'MATCHED_VERIFIED',
      }),
    );
  });

  it('persists a sanitized mismatch failure and performs no balance update', async () => {
    one.mockResolvedValueOnce({ ...scope, amount: '125.51' });
    optional.mockResolvedValueOnce(undefined);
    finalizeWithin.mockResolvedValueOnce({
      attempt: finalized(VerificationAttemptResult.FAILED, 'AMOUNT_MISMATCH'),
      replayed: false,
    });

    await expect(service.post(input)).resolves.toMatchObject({
      decision: 'FAILED',
      failureCode: 'AMOUNT_MISMATCH',
    });
    expect(one).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });

  it('records a duplicate against the original transaction without a ledger effect', async () => {
    one.mockResolvedValueOnce(scope);
    optional.mockResolvedValueOnce({
      id: 'original-confirmation-id',
      transaction_id: 'original-transaction-id',
      verification_attempt_id: 'original-attempt-id',
    });
    finalizeWithin.mockResolvedValueOnce({
      attempt: finalized(VerificationAttemptResult.DUPLICATE),
      replayed: false,
    });

    await expect(service.post(input)).resolves.toMatchObject({
      decision: 'DUPLICATE',
      originalTransactionId: 'original-transaction-id',
    });
    expect(execute).toHaveBeenCalledTimes(1);
    expect(one).toHaveBeenCalledTimes(1);
  });

  it('returns an exact verified replay without changing account or ledger', async () => {
    one.mockResolvedValueOnce(scope).mockResolvedValueOnce({
      confirmation_id: 'confirmation-id',
      ledger_entry_id: 'ledger-id',
      original_transaction_id: null,
    });
    optional.mockResolvedValueOnce({
      id: 'confirmation-id',
      transaction_id: 'transaction-id',
      verification_attempt_id: 'attempt-id',
    });
    finalizeWithin.mockResolvedValueOnce({
      attempt: finalized(VerificationAttemptResult.VERIFIED),
      replayed: true,
    });

    await expect(service.post(input)).resolves.toMatchObject({
      decision: 'VERIFIED',
      replayed: true,
      ledgerEntryId: 'ledger-id',
    });
    expect(one).toHaveBeenCalledTimes(2);
    expect(transitionWithin).not.toHaveBeenCalled();
  });

  it('treats another attempt for an already confirmed transaction as a financial replay', async () => {
    one.mockResolvedValueOnce(scope).mockResolvedValueOnce({
      confirmation_id: 'confirmation-id',
      ledger_entry_id: 'ledger-id',
      original_transaction_id: null,
    });
    optional.mockResolvedValueOnce({
      id: 'confirmation-id',
      transaction_id: 'transaction-id',
      verification_attempt_id: 'original-attempt-id',
    });
    finalizeWithin.mockResolvedValueOnce({
      attempt: finalized(VerificationAttemptResult.VERIFIED),
      replayed: false,
    });

    await expect(service.post(input)).resolves.toMatchObject({
      decision: 'VERIFIED',
      replayed: true,
      confirmationId: 'confirmation-id',
      ledgerEntryId: 'ledger-id',
    });
    expect(one).toHaveBeenCalledTimes(2);
    expect(execute).not.toHaveBeenCalled();
    expect(transitionWithin).not.toHaveBeenCalled();
  });

  it('rejects non-canonical amounts and receiver identifiers before querying', () => {
    expect(() => service.post({ ...input, amount: '125.5' })).toThrow(
      'input is invalid',
    );
    expect(() =>
      service.post({ ...input, receiverAccountSuffix: '***1234' }),
    ).toThrow('input is invalid');
    expect(transaction).not.toHaveBeenCalled();
  });
});
