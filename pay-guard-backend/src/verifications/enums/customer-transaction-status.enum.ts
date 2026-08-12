export enum CustomerTransactionStatus {
  PROCESSING = 'PROCESSING',
  VERIFIED = 'VERIFIED',
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  DUPLICATE = 'DUPLICATE',
  WAITING_CREDITS = 'WAITING_CREDITS',
  PAUSED_BRANCH = 'PAUSED_BRANCH',
}

export const FINAL_CUSTOMER_TRANSACTION_STATUSES =
  new Set<CustomerTransactionStatus>([
    CustomerTransactionStatus.VERIFIED,
    CustomerTransactionStatus.FAILED,
    CustomerTransactionStatus.DUPLICATE,
  ]);
