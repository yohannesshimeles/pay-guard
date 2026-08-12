import { ReceiptTransactionMatcherService } from '../../src/qr-processing/receipt-transaction-matcher.service';

describe('ReceiptTransactionMatcherService', () => {
  const service = new ReceiptTransactionMatcherService();
  const transaction = {
    businessId: 'business-id',
    branchId: 'branch-id',
    submittedByUserId: 'user-id',
    transactionReference: 'REF-001',
    amount: '125.50',
    transactionDate: '2026-08-08',
    transactionTime: '12:30:00',
    bankIdentifier: 'cbe',
    accountSuffix: '1234',
  };
  const payload = {
    status: 'COMPLETE' as const,
    bankCode: 'CBE' as const,
    reference: 'REF-001',
    amountEtb: '125.50',
    transactionDate: '2026-08-08',
    transactionTime: '12:30',
    accountSuffix: '1234',
    directVerificationSupported: true,
  };

  it('matches normalized bank and all supplied financial fields', () => {
    expect(service.match(transaction, payload)).toEqual({ decision: 'MATCHED' });
  });

  it.each([
    ['bankCode', 'BOA', 'BANK_MISMATCH'],
    ['reference', 'REF-OTHER', 'REFERENCE_MISMATCH'],
    ['amountEtb', '126.50', 'AMOUNT_MISMATCH'],
    ['transactionDate', '2026-08-07', 'DATE_MISMATCH'],
    ['transactionTime', '12:31', 'TIME_MISMATCH'],
    ['accountSuffix', '9999', 'ACCOUNT_MISMATCH'],
  ] as const)('rejects a mismatched %s before verification', (key, value, reasonCode) => {
    expect(service.match(transaction, { ...payload, [key]: value })).toEqual({
      decision: 'REVIEW_REQUIRED',
      reasonCode,
    });
  });
});
