import { Injectable } from '@nestjs/common';
import {
  CustomerTransactionStatus,
  FINAL_CUSTOMER_TRANSACTION_STATUSES,
} from './enums/customer-transaction-status.enum';
import { VerificationTransitionSource } from './enums/verification-transition-source.enum';

const allowedTargets: Readonly<
  Record<CustomerTransactionStatus, ReadonlySet<CustomerTransactionStatus>>
> = {
  [CustomerTransactionStatus.PROCESSING]: new Set([
    CustomerTransactionStatus.PENDING,
    CustomerTransactionStatus.VERIFIED,
    CustomerTransactionStatus.FAILED,
    CustomerTransactionStatus.DUPLICATE,
    CustomerTransactionStatus.WAITING_CREDITS,
    CustomerTransactionStatus.PAUSED_BRANCH,
  ]),
  [CustomerTransactionStatus.WAITING_CREDITS]: new Set([
    CustomerTransactionStatus.PROCESSING,
    CustomerTransactionStatus.PAUSED_BRANCH,
    CustomerTransactionStatus.FAILED,
  ]),
  [CustomerTransactionStatus.PAUSED_BRANCH]: new Set([
    CustomerTransactionStatus.PROCESSING,
    CustomerTransactionStatus.WAITING_CREDITS,
    CustomerTransactionStatus.FAILED,
  ]),
  [CustomerTransactionStatus.PENDING]: new Set([
    CustomerTransactionStatus.PROCESSING,
    CustomerTransactionStatus.VERIFIED,
    CustomerTransactionStatus.FAILED,
    CustomerTransactionStatus.DUPLICATE,
    CustomerTransactionStatus.PAUSED_BRANCH,
  ]),
  [CustomerTransactionStatus.VERIFIED]: new Set(),
  [CustomerTransactionStatus.FAILED]: new Set(),
  [CustomerTransactionStatus.DUPLICATE]: new Set(),
};

const allowedSources: Readonly<
  Partial<
    Record<CustomerTransactionStatus, ReadonlySet<VerificationTransitionSource>>
  >
> = {
  [CustomerTransactionStatus.PENDING]: new Set([
    VerificationTransitionSource.VERIFYET,
    VerificationTransitionSource.SYSTEM,
  ]),
  [CustomerTransactionStatus.VERIFIED]: new Set([
    VerificationTransitionSource.VERIFYET,
    VerificationTransitionSource.SYSTEM,
  ]),
  [CustomerTransactionStatus.DUPLICATE]: new Set([
    VerificationTransitionSource.VERIFYET,
    VerificationTransitionSource.SYSTEM,
  ]),
  [CustomerTransactionStatus.WAITING_CREDITS]: new Set([
    VerificationTransitionSource.CREDIT_POLICY,
    VerificationTransitionSource.SYSTEM,
  ]),
};

export class InvalidVerificationTransitionError extends Error {
  readonly name = 'InvalidVerificationTransitionError';

  constructor() {
    super('Verification status transition is not allowed');
  }
}

@Injectable()
export class VerificationStateMachineService {
  assertTransition(
    from: CustomerTransactionStatus,
    to: CustomerTransactionStatus,
    source: VerificationTransitionSource,
  ): void {
    if (
      FINAL_CUSTOMER_TRANSACTION_STATUSES.has(from) ||
      !allowedTargets[from]?.has(to) ||
      (allowedSources[to] !== undefined && !allowedSources[to]?.has(source))
    ) {
      throw new InvalidVerificationTransitionError();
    }
  }

  isFinal(status: CustomerTransactionStatus): boolean {
    return FINAL_CUSTOMER_TRANSACTION_STATUSES.has(status);
  }
}
