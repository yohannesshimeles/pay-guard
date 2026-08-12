import { VerificationAttemptResult } from '../enums/verification-attempt-result.enum';
import { VerificationAttemptType } from '../enums/verification-attempt-type.enum';

export type VerificationAttemptEntityProps = {
  id: string;
  transactionId: string;
  businessId: string;
  branchId: string;
  attemptKey: string;
  attemptType: VerificationAttemptType;
  attemptNumber: number;
  result: VerificationAttemptResult;
  creditTransactionId?: string;
  providerRequestId?: string;
  providerStatus?: string;
  requestedAt?: Date;
  respondedAt?: Date;
  responseTimeMs?: number;
  errorCode?: string;
  createdAt: Date;
};

export class VerificationAttemptEntity {
  readonly id: string;
  readonly transactionId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly attemptKey: string;
  readonly attemptType: VerificationAttemptType;
  readonly attemptNumber: number;
  readonly result: VerificationAttemptResult;
  readonly creditTransactionId?: string;
  readonly providerRequestId?: string;
  readonly providerStatus?: string;
  readonly requestedAt?: Date;
  readonly respondedAt?: Date;
  readonly responseTimeMs?: number;
  readonly errorCode?: string;
  readonly createdAt: Date;

  constructor(props: VerificationAttemptEntityProps) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{15,159}$/u.test(props.attemptKey)) {
      throw new Error('Verification attempt key is invalid');
    }
    if (
      props.providerRequestId &&
      !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(props.providerRequestId)
    ) {
      throw new Error('Verification provider request ID is invalid');
    }
    if (
      props.providerStatus &&
      !/^[A-Z0-9_]{1,24}$/u.test(props.providerStatus)
    ) {
      throw new Error('Verification provider status is invalid');
    }
    if (!Number.isInteger(props.attemptNumber) || props.attemptNumber < 1) {
      throw new Error('Verification attempt number must be positive');
    }
    if (
      props.responseTimeMs !== undefined &&
      (!Number.isInteger(props.responseTimeMs) || props.responseTimeMs < 0)
    ) {
      throw new Error('Verification response time is invalid');
    }
    if (props.respondedAt && !props.requestedAt) {
      throw new Error('Verification response requires a request timestamp');
    }
    if (
      props.requestedAt &&
      props.respondedAt &&
      props.respondedAt.getTime() < props.requestedAt.getTime()
    ) {
      throw new Error('Verification response precedes its request');
    }
    if (props.errorCode && !/^[A-Z0-9_]{1,80}$/u.test(props.errorCode)) {
      throw new Error('Verification error code is invalid');
    }

    this.id = props.id;
    this.transactionId = props.transactionId;
    this.businessId = props.businessId;
    this.branchId = props.branchId;
    this.attemptKey = props.attemptKey;
    this.attemptType = props.attemptType;
    this.attemptNumber = props.attemptNumber;
    this.result = props.result;
    this.creditTransactionId = props.creditTransactionId;
    this.providerRequestId = props.providerRequestId;
    this.providerStatus = props.providerStatus;
    this.requestedAt = props.requestedAt;
    this.respondedAt = props.respondedAt;
    this.responseTimeMs = props.responseTimeMs;
    this.errorCode = props.errorCode;
    this.createdAt = props.createdAt;
  }
}
