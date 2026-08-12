import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../../src/auth/auth.types';
import { CentralDao } from '../../src/database/central.dao';
import { TransactionReceiptAccessDao } from '../../src/qr-processing/transaction-receipt-access.dao';

const principal: AuthenticatedPrincipal = {
  userId: '00000000-0000-4000-8000-000000000001',
  sessionId: '00000000-0000-4000-8000-000000000002',
  role: 'WAITER',
  businessIds: ['00000000-0000-4000-8000-000000000003'],
  branchId: '00000000-0000-4000-8000-000000000004',
};

function createDao(row: object | undefined) {
  const central = { optional: jest.fn().mockResolvedValue(row) };
  return {
    service: new TransactionReceiptAccessDao(
      central as unknown as CentralDao,
    ),
    central,
  };
}

describe('TransactionReceiptAccessDao', () => {
  it('allows a Waiter to upload to their own scoped transaction', async () => {
    const { service, central } = createDao({
      business_id: principal.businessIds[0],
      branch_id: principal.branchId,
      submitted_by_user_id: principal.userId,
      transaction_reference: 'REF-001',
      amount: '125.50',
      transaction_date: '2026-08-08',
      transaction_time: '12:30:00',
      verifyet_bank_identifier: 'CBE',
      normalized_account_suffix: '1234',
    });

    await expect(
      service.assertCanUpload('00000000-0000-4000-8000-000000000005', principal),
    ).resolves.toEqual({
      businessId: principal.businessIds[0],
      branchId: principal.branchId,
      submittedByUserId: principal.userId,
      transactionReference: 'REF-001',
      amount: '125.50',
      transactionDate: '2026-08-08',
      transactionTime: '12:30:00',
      bankIdentifier: 'CBE',
      accountSuffix: '1234',
    });
    expect(central.optional).toHaveBeenCalledWith(
      expect.stringContaining('FROM customer_transactions'),
      ['00000000-0000-4000-8000-000000000005'],
    );
  });

  it('conceals a missing transaction behind a not-found response', async () => {
    const { service } = createDao(undefined);
    await expect(
      service.assertCanUpload('00000000-0000-4000-8000-000000000005', principal),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it.each([
    ['another business', { business_id: 'other-business' }],
    ['another branch', { branch_id: 'other-branch' }],
    ['another Waiter', { submitted_by_user_id: 'other-user' }],
  ])('rejects %s scope', async (_case, override) => {
    const { service } = createDao({
      business_id: principal.businessIds[0],
      branch_id: principal.branchId,
      submitted_by_user_id: principal.userId,
      transaction_reference: 'REF-001',
      amount: '125.50',
      transaction_date: '2026-08-08',
      transaction_time: '12:30:00',
      verifyet_bank_identifier: 'CBE',
      normalized_account_suffix: '1234',
      ...override,
    });
    await expect(
      service.assertCanUpload('00000000-0000-4000-8000-000000000005', principal),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
