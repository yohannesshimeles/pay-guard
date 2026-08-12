import { CustomerTransactionStatus } from '../enums/customer-transaction-status.enum';

export type VerificationEligibilityModel =
  | Readonly<{
      decision: 'ELIGIBLE';
      transactionStatus: CustomerTransactionStatus;
      creditConsumed: boolean;
      replayed: boolean;
      creditTransactionId?: string;
      balanceBefore?: number;
      balanceAfter?: number;
    }>
  | Readonly<{
      decision: 'WAITING_CREDITS' | 'PAUSED_BRANCH';
      transactionStatus: CustomerTransactionStatus;
      creditConsumed: false;
      replayed: false;
    }>;
