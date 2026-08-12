import { CustomerTransactionStatus } from '../enums/customer-transaction-status.enum';
import { VerificationTransitionSource } from '../enums/verification-transition-source.enum';

export type VerificationTransitionModel = Readonly<{
  transactionId: string;
  fromStatus: CustomerTransactionStatus;
  toStatus: CustomerTransactionStatus;
  source: VerificationTransitionSource;
  reasonCode?: string;
  changedByUserId?: string;
  verificationAttemptId?: string;
  changedAt: Date;
}>;
