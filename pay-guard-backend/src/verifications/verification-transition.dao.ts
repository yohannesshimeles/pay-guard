import { Injectable } from '@nestjs/common';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { CustomerTransactionStatus } from './enums/customer-transaction-status.enum';
import { VerificationTransitionSource } from './enums/verification-transition-source.enum';
import { VerificationTransitionModel } from './models/verification-transition.model';
import { VerificationStateMachineService } from './verification-state-machine.service';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';

type TransactionStatusRow = {
  id: string;
  current_status: CustomerTransactionStatus;
};

type TransitionRow = {
  transaction_id: string;
  from_status: CustomerTransactionStatus;
  to_status: CustomerTransactionStatus;
  reason: string | null;
  changed_by_user_id: string | null;
  verification_attempt_id: string | null;
  transition_source: VerificationTransitionSource;
  created_at: Date;
};

export type TransitionVerificationTransaction = {
  transactionId: string;
  toStatus: CustomerTransactionStatus;
  source: VerificationTransitionSource;
  reasonCode?: string;
  changedByUserId?: string;
  verificationAttemptId?: string;
};

@Injectable()
export class VerificationTransitionDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly stateMachine: VerificationStateMachineService,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  transition(
    input: TransitionVerificationTransaction,
  ): Promise<VerificationTransitionModel> {
    this.validateReasonCode(input.reasonCode);
    return this.dao.transaction((transaction) =>
      this.transitionWithin(transaction, input),
    );
  }

  async transitionWithin(
    transaction: DaoTransaction,
    input: TransitionVerificationTransaction,
  ): Promise<VerificationTransitionModel> {
    this.validateReasonCode(input.reasonCode);
    const current = await transaction.one<TransactionStatusRow>(
      `SELECT id, current_status
       FROM customer_transactions
       WHERE id = $1
       FOR UPDATE`,
      [input.transactionId],
    );
    this.stateMachine.assertTransition(
      current.current_status,
      input.toStatus,
      input.source,
    );

    await transaction.one<TransactionStatusRow>(
      `UPDATE customer_transactions
       SET current_status = $2::varchar(28),
           failure_reason = CASE
             WHEN $2::varchar(28) = 'FAILED' THEN $3::text
             ELSE NULL
           END,
           finalized_at = CASE
             WHEN $2::varchar(28) IN ('VERIFIED','FAILED','DUPLICATE') THEN now()
             ELSE NULL
           END
       WHERE id = $1
         AND current_status = $4
       RETURNING id, current_status`,
      [
        input.transactionId,
        input.toStatus,
        input.reasonCode ?? null,
        current.current_status,
      ],
    );

    const history = await transaction.one<TransitionRow>(
      `INSERT INTO transaction_status_history (
         transaction_id, from_status, to_status, reason,
         changed_by_user_id, verification_attempt_id, transition_source
       ) VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.transactionId,
        current.current_status,
        input.toStatus,
        input.reasonCode ?? null,
        input.changedByUserId ?? null,
        input.verificationAttemptId ?? null,
        input.source,
      ],
    );
    await this.notifications.notifyTransactionSubmitterWithin(transaction, {
      transactionId: input.transactionId,
      status: input.toStatus,
    });
    return this.map(history);
  }

  private validateReasonCode(reasonCode?: string): void {
    if (reasonCode && !/^[A-Z0-9_]{1,80}$/u.test(reasonCode)) {
      throw new Error('Verification transition reason code is invalid');
    }
  }

  private map(row: TransitionRow): VerificationTransitionModel {
    return {
      transactionId: row.transaction_id,
      fromStatus: row.from_status,
      toStatus: row.to_status,
      source: row.transition_source,
      reasonCode: row.reason ?? undefined,
      changedByUserId: row.changed_by_user_id ?? undefined,
      verificationAttemptId: row.verification_attempt_id ?? undefined,
      changedAt: row.created_at,
    };
  }
}
