import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { PendingRecheckEntity } from './entities/pending-recheck.entity';
import { CustomerTransactionStatus } from './enums/customer-transaction-status.enum';
import { PendingRecheckStatus } from './enums/pending-recheck-status.enum';

type PendingRecheckRow = {
  id: string;
  transaction_id: string;
  business_id: string;
  branch_id: string;
  recheck_number: number;
  scheduled_at: Date;
  status: PendingRecheckStatus;
  claim_token: string | null;
  claimed_by: string | null;
  claimed_at: Date | null;
  claim_expires_at: Date | null;
  verification_attempt_id: string | null;
  pause_reason: string | null;
  paused_at: Date | null;
  resumed_at: Date | null;
  completed_at: Date | null;
  last_error_code: string | null;
  created_at: Date;
};

export type SchedulePendingRecheck = {
  transactionId: string;
  recheckNumber: number;
  scheduledAt: Date;
};

export class PendingRecheckScheduleConflictError extends Error {
  readonly name = 'PendingRecheckScheduleConflictError';

  constructor() {
    super('Pending recheck number is already scheduled differently');
  }
}

export class PendingRecheckClaimLostError extends Error {
  readonly name = 'PendingRecheckClaimLostError';

  constructor() {
    super('Pending recheck claim is no longer owned by this worker');
  }
}

@Injectable()
export class PendingRecheckDao {
  constructor(private readonly dao: CentralDao) {}

  schedule(input: SchedulePendingRecheck): Promise<PendingRecheckEntity> {
    this.validateSchedule(input);
    return this.dao.transaction((transaction) =>
      this.scheduleWithin(transaction, input),
    );
  }

  async scheduleWithin(
    transaction: DaoTransaction,
    input: SchedulePendingRecheck,
  ): Promise<PendingRecheckEntity> {
    this.validateSchedule(input);
    const scope = await transaction.one<{
      current_status: CustomerTransactionStatus;
    }>(
      `SELECT current_status
       FROM customer_transactions
       WHERE id = $1
       FOR UPDATE`,
      [input.transactionId],
    );
    if (scope.current_status !== CustomerTransactionStatus.PENDING) {
      throw new Error('Pending recheck requires a pending transaction');
    }

    const inserted = await transaction.optional<PendingRecheckRow>(
      `INSERT INTO pending_rechecks (
         transaction_id, recheck_number, scheduled_at, status
       ) VALUES ($1, $2, $3, 'SCHEDULED')
       ON CONFLICT (transaction_id, recheck_number) DO NOTHING
       RETURNING ${this.returningColumns()}`,
      [input.transactionId, input.recheckNumber, input.scheduledAt],
    );
    const recheck = inserted
      ? this.map(inserted)
      : await this.requireByIdentityWithin(transaction, input);
    if (
      recheck.scheduledAt.getTime() !== input.scheduledAt.getTime() ||
      recheck.status === PendingRecheckStatus.CANCELLED
    ) {
      throw new PendingRecheckScheduleConflictError();
    }
    return recheck;
  }

  claimNext(
    workerId: string,
    leaseSeconds = 60,
  ): Promise<PendingRecheckEntity | undefined> {
    this.validateWorker(workerId, leaseSeconds);
    return this.dao.transaction(async (transaction) => {
      const row = await transaction.optional<PendingRecheckRow>(
        `WITH candidate AS (
           SELECT id
           FROM pending_rechecks
           WHERE (status = 'SCHEDULED' AND scheduled_at <= now())
              OR (status = 'CLAIMED' AND claim_expires_at <= now())
           ORDER BY scheduled_at, id
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         UPDATE pending_rechecks recheck
         SET status = 'CLAIMED',
             claim_token = gen_random_uuid(),
             claimed_by = $1,
             claimed_at = now(),
             claim_expires_at = now() + ($2::integer * interval '1 second'),
             last_error_code = NULL
         FROM candidate
         WHERE recheck.id = candidate.id
         RETURNING ${this.returningColumns('recheck')}`,
        [workerId, leaseSeconds],
      );
      return row ? this.map(row) : undefined;
    });
  }

  completeClaim(
    recheckId: string,
    claimToken: string,
    verificationAttemptId: string,
  ): Promise<PendingRecheckEntity> {
    return this.mutateOwnedClaim(
      recheckId,
      claimToken,
      `status = 'COMPLETED',
       verification_attempt_id = $3,
       completed_at = now(),
       claim_token = NULL,
       claimed_by = NULL,
       claimed_at = NULL,
       claim_expires_at = NULL`,
      [verificationAttemptId],
    );
  }

  async bindAttemptToClaim(
    recheckId: string,
    claimToken: string,
    verificationAttemptId: string,
  ): Promise<PendingRecheckEntity> {
    const row = await this.dao.optional<PendingRecheckRow>(
      `UPDATE pending_rechecks recheck
       SET verification_attempt_id = $3
       WHERE id = $1
         AND claim_token = $2
         AND status = 'CLAIMED'
         AND claim_expires_at > now()
         AND (verification_attempt_id IS NULL OR verification_attempt_id = $3)
       RETURNING ${this.returningColumns('recheck')}`,
      [recheckId, claimToken, verificationAttemptId],
    );
    if (!row) throw new PendingRecheckClaimLostError();
    return this.map(row);
  }

  renewClaim(
    recheckId: string,
    claimToken: string,
    leaseSeconds = 60,
  ): Promise<PendingRecheckEntity> {
    this.validateLeaseSeconds(leaseSeconds);
    return this.mutateOwnedClaim(
      recheckId,
      claimToken,
      `claim_expires_at = now() + ($3::integer * interval '1 second')`,
      [leaseSeconds],
    );
  }

  deferClaim(
    recheckId: string,
    claimToken: string,
    scheduledAt: Date,
    errorCode: string,
  ): Promise<PendingRecheckEntity> {
    this.validateErrorCode(errorCode);
    if (Number.isNaN(scheduledAt.getTime())) {
      throw new Error('Pending recheck schedule is invalid');
    }
    return this.mutateOwnedClaim(
      recheckId,
      claimToken,
      `status = 'SCHEDULED',
       scheduled_at = $3,
       last_error_code = $4,
       claim_token = NULL,
       claimed_by = NULL,
       claimed_at = NULL,
       claim_expires_at = NULL`,
      [scheduledAt, errorCode],
    );
  }

  pauseClaim(
    recheckId: string,
    claimToken: string,
    status:
      | PendingRecheckStatus.WAITING_CREDITS
      | PendingRecheckStatus.PAUSED_BRANCH
      | PendingRecheckStatus.PAUSED_PROVIDER,
    reasonCode: string,
  ): Promise<PendingRecheckEntity> {
    this.validateErrorCode(reasonCode);
    return this.mutateOwnedClaim(
      recheckId,
      claimToken,
      `status = $3,
       pause_reason = $4,
       last_error_code = $4,
       paused_at = now(),
       claim_token = NULL,
       claimed_by = NULL,
       claimed_at = NULL,
       claim_expires_at = NULL`,
      [status, reasonCode],
    );
  }

  private async mutateOwnedClaim(
    recheckId: string,
    claimToken: string,
    assignments: string,
    values: readonly unknown[],
  ): Promise<PendingRecheckEntity> {
    const row = await this.dao.optional<PendingRecheckRow>(
      `UPDATE pending_rechecks recheck
       SET ${assignments}
       WHERE id = $1
         AND claim_token = $2
         AND status = 'CLAIMED'
         AND claim_expires_at > now()
       RETURNING ${this.returningColumns('recheck')}`,
      [recheckId, claimToken, ...values],
    );
    if (!row) throw new PendingRecheckClaimLostError();
    return this.map(row);
  }

  private async requireByIdentityWithin(
    transaction: DaoTransaction,
    input: SchedulePendingRecheck,
  ): Promise<PendingRecheckEntity> {
    const row = await transaction.one<PendingRecheckRow>(
      `SELECT ${this.selectColumns('recheck')}
       FROM pending_rechecks recheck
       JOIN customer_transactions customer_transaction
         ON customer_transaction.id = recheck.transaction_id
       WHERE recheck.transaction_id = $1
         AND recheck.recheck_number = $2
       FOR UPDATE OF recheck`,
      [input.transactionId, input.recheckNumber],
    );
    return this.map(row);
  }

  private returningColumns(alias = 'pending_rechecks'): string {
    return `${alias}.id, ${alias}.transaction_id,
            (SELECT business_id FROM customer_transactions WHERE id = ${alias}.transaction_id) AS business_id,
            (SELECT branch_id FROM customer_transactions WHERE id = ${alias}.transaction_id) AS branch_id,
            ${alias}.recheck_number, ${alias}.scheduled_at, ${alias}.status,
            ${alias}.claim_token, ${alias}.claimed_by, ${alias}.claimed_at,
            ${alias}.claim_expires_at, ${alias}.verification_attempt_id,
            ${alias}.pause_reason, ${alias}.paused_at, ${alias}.resumed_at,
            ${alias}.completed_at, ${alias}.last_error_code, ${alias}.created_at`;
  }

  private selectColumns(alias: string): string {
    return `${alias}.id, ${alias}.transaction_id,
            customer_transaction.business_id, customer_transaction.branch_id,
            ${alias}.recheck_number, ${alias}.scheduled_at, ${alias}.status,
            ${alias}.claim_token, ${alias}.claimed_by, ${alias}.claimed_at,
            ${alias}.claim_expires_at, ${alias}.verification_attempt_id,
            ${alias}.pause_reason, ${alias}.paused_at, ${alias}.resumed_at,
            ${alias}.completed_at, ${alias}.last_error_code, ${alias}.created_at`;
  }

  private validateSchedule(input: SchedulePendingRecheck): void {
    if (
      !Number.isInteger(input.recheckNumber) ||
      input.recheckNumber < 1 ||
      input.recheckNumber > 3 ||
      Number.isNaN(input.scheduledAt.getTime())
    ) {
      throw new Error('Pending recheck schedule is invalid');
    }
  }

  private validateWorker(workerId: string, leaseSeconds: number): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$/u.test(workerId)) {
      throw new Error('Pending recheck worker lease is invalid');
    }
    this.validateLeaseSeconds(leaseSeconds);
  }

  private validateLeaseSeconds(leaseSeconds: number): void {
    if (
      !Number.isInteger(leaseSeconds) ||
      leaseSeconds < 5 ||
      leaseSeconds > 300
    ) {
      throw new Error('Pending recheck worker lease is invalid');
    }
  }

  private validateErrorCode(errorCode: string): void {
    if (!/^[A-Z0-9_]{1,80}$/u.test(errorCode)) {
      throw new Error('Pending recheck error code is invalid');
    }
  }

  private map(row: PendingRecheckRow): PendingRecheckEntity {
    return new PendingRecheckEntity({
      id: row.id,
      transactionId: row.transaction_id,
      businessId: row.business_id,
      branchId: row.branch_id,
      recheckNumber: row.recheck_number,
      scheduledAt: row.scheduled_at,
      status: row.status,
      claimToken: row.claim_token ?? undefined,
      claimedBy: row.claimed_by ?? undefined,
      claimedAt: row.claimed_at ?? undefined,
      claimExpiresAt: row.claim_expires_at ?? undefined,
      verificationAttemptId: row.verification_attempt_id ?? undefined,
      pauseReason: row.pause_reason ?? undefined,
      pausedAt: row.paused_at ?? undefined,
      resumedAt: row.resumed_at ?? undefined,
      completedAt: row.completed_at ?? undefined,
      lastErrorCode: row.last_error_code ?? undefined,
      createdAt: row.created_at,
    });
  }
}
