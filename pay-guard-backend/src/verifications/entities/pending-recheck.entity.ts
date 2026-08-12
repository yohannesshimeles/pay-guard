import { PendingRecheckStatus } from '../enums/pending-recheck-status.enum';

export type PendingRecheckEntityProps = {
  id: string;
  transactionId: string;
  businessId: string;
  branchId: string;
  recheckNumber: number;
  scheduledAt: Date;
  status: PendingRecheckStatus;
  claimToken?: string;
  claimedBy?: string;
  claimedAt?: Date;
  claimExpiresAt?: Date;
  verificationAttemptId?: string;
  pauseReason?: string;
  pausedAt?: Date;
  resumedAt?: Date;
  completedAt?: Date;
  lastErrorCode?: string;
  createdAt: Date;
};

export class PendingRecheckEntity {
  readonly id!: string;
  readonly transactionId!: string;
  readonly businessId!: string;
  readonly branchId!: string;
  readonly recheckNumber!: number;
  readonly scheduledAt!: Date;
  readonly status!: PendingRecheckStatus;
  readonly claimToken?: string;
  readonly claimedBy?: string;
  readonly claimedAt?: Date;
  readonly claimExpiresAt?: Date;
  readonly verificationAttemptId?: string;
  readonly pauseReason?: string;
  readonly pausedAt?: Date;
  readonly resumedAt?: Date;
  readonly completedAt?: Date;
  readonly lastErrorCode?: string;
  readonly createdAt!: Date;

  constructor(props: PendingRecheckEntityProps) {
    if (
      !Number.isInteger(props.recheckNumber) ||
      props.recheckNumber < 1 ||
      props.recheckNumber > 3
    ) {
      throw new Error('Pending recheck number must be between one and three');
    }
    const claimFields = [
      props.claimToken,
      props.claimedBy,
      props.claimedAt,
      props.claimExpiresAt,
    ];
    const hasAnyClaim = claimFields.some((value) => value !== undefined);
    const hasCompleteClaim = claimFields.every((value) => value !== undefined);
    if (
      (props.status === PendingRecheckStatus.CLAIMED && !hasCompleteClaim) ||
      (props.status !== PendingRecheckStatus.CLAIMED && hasAnyClaim)
    ) {
      throw new Error('Pending recheck claim lease is inconsistent');
    }
    if (
      props.claimedAt &&
      props.claimExpiresAt &&
      props.claimExpiresAt <= props.claimedAt
    ) {
      throw new Error('Pending recheck claim expiry is invalid');
    }
    if (
      (props.status === PendingRecheckStatus.COMPLETED) !==
      (props.completedAt !== undefined)
    ) {
      throw new Error('Pending recheck completion timestamp is inconsistent');
    }
    if (
      props.lastErrorCode &&
      !/^[A-Z0-9_]{1,80}$/u.test(props.lastErrorCode)
    ) {
      throw new Error('Pending recheck error code is invalid');
    }

    Object.assign(this, props);
  }
}
