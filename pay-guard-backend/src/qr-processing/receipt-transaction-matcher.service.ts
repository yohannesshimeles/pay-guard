import { Injectable } from '@nestjs/common';
import { ParsedQrPayloadModel } from './models/parsed-qr-payload.model';
import { TransactionReceiptScope } from './transaction-receipt-access.dao';

export type ReceiptMatchResult =
  | Readonly<{ decision: 'MATCHED' }>
  | Readonly<{
      decision: 'REVIEW_REQUIRED';
      reasonCode:
        | 'BANK_MISMATCH'
        | 'REFERENCE_MISMATCH'
        | 'AMOUNT_MISMATCH'
        | 'DATE_MISMATCH'
        | 'TIME_MISMATCH'
        | 'ACCOUNT_MISMATCH';
    }>;

@Injectable()
export class ReceiptTransactionMatcherService {
  match(
    transaction: TransactionReceiptScope,
    payload: ParsedQrPayloadModel,
  ): ReceiptMatchResult {
    if (
      this.normalizeBank(transaction.bankIdentifier) !==
      this.normalizeBank(payload.bankCode ?? '')
    ) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'BANK_MISMATCH' };
    }
    if (payload.reference !== transaction.transactionReference) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'REFERENCE_MISMATCH' };
    }
    if (payload.amountEtb && payload.amountEtb !== transaction.amount) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'AMOUNT_MISMATCH' };
    }
    if (
      payload.transactionDate &&
      payload.transactionDate !== transaction.transactionDate
    ) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'DATE_MISMATCH' };
    }
    if (
      payload.transactionTime &&
      !transaction.transactionTime.startsWith(payload.transactionTime)
    ) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'TIME_MISMATCH' };
    }
    if (
      payload.accountSuffix &&
      payload.accountSuffix !== transaction.accountSuffix
    ) {
      return { decision: 'REVIEW_REQUIRED', reasonCode: 'ACCOUNT_MISMATCH' };
    }
    return { decision: 'MATCHED' };
  }

  private normalizeBank(value: string): string {
    return value.toUpperCase().replace(/[^A-Z0-9]/gu, '');
  }
}
