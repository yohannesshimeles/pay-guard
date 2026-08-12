import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { ReconciliationEntity, ReconciliationProps, ReconciliationStatus } from './reconciliation.entity';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';

type ScopeRow = {
  closing_time: string;
  period_start: Date;
  period_end: Date;
};
type TotalsRow = {
  opening_balance: string;
  verified_deposits_total: string;
  manual_deposits_total: string;
  withdrawals_total: string;
  positive_corrections_total: string;
  negative_corrections_total: string;
  reversals_net_total: string;
  calculated_balance: string;
  difference: string;
};
type ReconciliationRow = {
  id: string;
  business_id: string;
  branch_id: string;
  settlement_account_id: string;
  reconciliation_date: string;
  closing_time: string;
  opening_balance: string;
  verified_deposits_total: string;
  manual_deposits_total: string;
  withdrawals_total: string;
  positive_corrections_total: string;
  negative_corrections_total: string;
  reversals_net_total: string;
  calculated_balance: string;
  actual_bank_balance: string;
  difference: string;
  description: string;
  difference_explanation: string | null;
  status: ReconciliationStatus;
  sequence_no: number;
  submitted_at: Date | null;
  decision_reason: string | null;
  decided_at: Date | null;
  created_at: Date;
};
type HistoryRow = {
  id: string;
  from_status: ReconciliationStatus | null;
  to_status: ReconciliationStatus;
  reason: string;
  created_at: Date;
};

export type CreateReconciliation = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  reconciliationDate: string;
  actualBankBalance: string;
  description: string;
  differenceExplanation?: string;
  actor: AuthenticatedPrincipal;
}>;

export class ReconciliationScopeError extends Error {}
export class ReconciliationScheduleNotFoundError extends Error {}
export class ReconciliationExplanationRequiredError extends Error {}
export class ReconciliationReplayConflictError extends Error {}
export class ReconciliationNotFoundError extends Error {}
export class ReconciliationTransitionError extends Error {}
export class ReconciliationDecisionConflictError extends Error {}

@Injectable()
export class ReconciliationDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  async createWithin(transaction: DaoTransaction, input: CreateReconciliation) {
    const scope = await this.lockScope(transaction, input);
    const existing = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (existing) {
      this.assertReplay(existing, input);
      return { reconciliation: existing, replayed: true };
    }
    const totals = await this.calculateTotals(transaction, input, scope);
    if (totals.difference !== '0.00' && !input.differenceExplanation) {
      throw new ReconciliationExplanationRequiredError();
    }
    const sequence = await transaction.one<{ sequence_no: number }>(
      `SELECT COALESCE(MAX(sequence_no), 0)::integer + 1 AS sequence_no
       FROM reconciliations
       WHERE settlement_account_id = $1 AND reconciliation_date = $2::date`,
      [input.settlementAccountId, input.reconciliationDate],
    );
    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, new_value, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,'RECONCILIATION_DRAFT_CREATED','RECONCILIATION',$6,
         jsonb_build_object('settlementAccountId',$7::text,
                            'reconciliationDate',$8::text,
                            'calculatedBalance',$9::text,
                            'actualBankBalance',$10::text,
                            'difference',$11::text),$12,'SUCCESS')
       RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId, input.id, input.settlementAccountId,
        input.reconciliationDate, totals.calculated_balance,
        input.actualBankBalance, totals.difference, input.actor.sessionId,
      ],
    );
    const returned = await transaction.optional<{ id: string }>(
      `SELECT id FROM reconciliations
       WHERE settlement_account_id = $1 AND reconciliation_date = $2::date
         AND status = 'RETURNED'
       ORDER BY sequence_no DESC LIMIT 1 FOR UPDATE`,
      [input.settlementAccountId, input.reconciliationDate],
    );
    if (returned) {
      await transaction.one<{ id: string }>(
        `UPDATE reconciliations SET status = 'SUPERSEDED'
         WHERE id = $1 RETURNING id`,
        [returned.id],
      );
      await this.insertHistory(transaction, {
        reconciliationId: returned.id, fromStatus: 'RETURNED',
        toStatus: 'SUPERSEDED', roleAssignmentId: input.actor.membershipRoleId!,
        reason: 'Cashier created a replacement reconciliation draft',
        auditLogId: audit.id,
      });
    }
    await transaction.one<{ id: string }>(
      `INSERT INTO reconciliations (
         id, business_id, branch_id, settlement_account_id,
         reconciliation_date, closing_time, opening_balance,
         verified_deposits_total, manual_deposits_total, withdrawals_total,
         positive_corrections_total, negative_corrections_total,
         reversals_net_total, calculated_balance, actual_bank_balance,
         difference, description, difference_explanation, status, sequence_no,
         submitted_by_role_assignment_id, submitted_at, idempotency_key
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,
         'DRAFT',$19,$20,NULL,$1
       ) RETURNING id`,
      [
        input.id, input.businessId, input.branchId, input.settlementAccountId,
        input.reconciliationDate, scope.closing_time, totals.opening_balance,
        totals.verified_deposits_total, totals.manual_deposits_total,
        totals.withdrawals_total, totals.positive_corrections_total,
        totals.negative_corrections_total, totals.reversals_net_total,
        totals.calculated_balance, input.actualBankBalance, totals.difference,
        input.description, input.differenceExplanation ?? null,
        sequence.sequence_no, input.actor.membershipRoleId,
      ],
    );
    await this.insertHistory(transaction, {
      reconciliationId: input.id, fromStatus: null, toStatus: 'DRAFT',
      roleAssignmentId: input.actor.membershipRoleId!,
      reason: 'Daily reconciliation draft created', auditLogId: audit.id,
    });
    const reconciliation = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (!reconciliation) throw new ReconciliationNotFoundError();
    return { reconciliation, replayed: false };
  }

  async submitWithin(
    transaction: DaoTransaction,
    input: {
      id: string;
      businessId: string;
      branchId: string;
      actor: AuthenticatedPrincipal;
    },
  ) {
    const row = await transaction.optional<{
      status: ReconciliationStatus;
      difference: string;
    }>(
      `SELECT reconciliation.status, reconciliation.difference::text
       FROM reconciliations reconciliation
       JOIN user_work_assignments work
         ON work.id = $1 AND work.business_id = $2 AND work.branch_id = $3
        AND work.membership_role_id = $4 AND work.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = $4 AND role_assignment.role_code = 'CASHIER'
        AND role_assignment.status = 'ACTIVE'
       JOIN business_user_memberships membership
         ON membership.id = role_assignment.membership_id
        AND membership.id = $5 AND membership.user_id = $6
        AND membership.business_id = $2 AND membership.status = 'ACTIVE'
       WHERE reconciliation.id = $7 AND reconciliation.business_id = $2
         AND reconciliation.branch_id = $3
         AND reconciliation.submitted_by_role_assignment_id = $4
       FOR UPDATE OF reconciliation`,
      [
        input.actor.workAssignmentId, input.businessId, input.branchId,
        input.actor.membershipRoleId, input.actor.membershipId,
        input.actor.userId, input.id,
      ],
    );
    if (!row) throw new ReconciliationNotFoundError();
    if (row.status === 'MATCHED' || row.status === 'DISCREPANCY') {
      const replay = await this.findWithin(transaction, input.id, input);
      if (!replay) throw new ReconciliationNotFoundError();
      return { reconciliation: replay, replayed: true };
    }
    if (row.status !== 'DRAFT') throw new ReconciliationTransitionError();

    const finalStatus: ReconciliationStatus =
      row.difference === '0.00' ? 'MATCHED' : 'DISCREPANCY';
    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, new_value, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,'RECONCILIATION_SUBMITTED','RECONCILIATION',$6,
         jsonb_build_object('finalStatus',$7::text,'difference',$8::text),
         $9,'SUCCESS') RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId, input.id, finalStatus,
        row.difference, input.actor.sessionId,
      ],
    );
    await transaction.one<{ id: string }>(
      `UPDATE reconciliations SET status = 'SUBMITTED'
       WHERE id = $1 RETURNING id`,
      [input.id],
    );
    await this.insertHistory(transaction, {
      reconciliationId: input.id, fromStatus: 'DRAFT', toStatus: 'SUBMITTED',
      roleAssignmentId: input.actor.membershipRoleId!,
      reason: 'Cashier submitted daily reconciliation', auditLogId: audit.id,
    });
    await transaction.one<{ id: string }>(
      `UPDATE reconciliations SET status = $2, submitted_at = now()
       WHERE id = $1 RETURNING id`,
      [input.id, finalStatus],
    );
    await this.insertHistory(transaction, {
      reconciliationId: input.id, fromStatus: 'SUBMITTED', toStatus: finalStatus,
      roleAssignmentId: input.actor.membershipRoleId!,
      reason: finalStatus === 'MATCHED'
        ? 'Calculated and actual bank balances match'
        : 'Calculated and actual bank balances differ',
      auditLogId: audit.id,
    });
    const reconciliation = await this.findWithin(transaction, input.id, input);
    if (!reconciliation) throw new ReconciliationNotFoundError();
    await this.notifications.notifyReconciliationReviewWithin(transaction, {
      reconciliationId: input.id, businessId: input.businessId,
      branchId: input.branchId, status: finalStatus,
    });
    return { reconciliation, replayed: false };
  }

  async decideWithin(
    transaction: DaoTransaction,
    input: {
      id: string;
      businessId: string;
      branchId: string;
      decision: 'APPROVED' | 'RETURNED';
      reason: string;
      actor: AuthenticatedPrincipal;
    },
  ) {
    const row = await transaction.optional<{
      status: ReconciliationStatus;
      decision_reason: string | null;
      decided_by_role_assignment_id: string | null;
    }>(
      `SELECT reconciliation.status, reconciliation.decision_reason,
              reconciliation.decided_by_role_assignment_id
       FROM reconciliations reconciliation
       JOIN user_work_assignments work
         ON work.id = $1 AND work.business_id = $2 AND work.branch_id = $3
        AND work.membership_role_id = $4 AND work.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = $4 AND role_assignment.role_code = 'MANAGER'
        AND role_assignment.status = 'ACTIVE'
       JOIN business_user_memberships membership
         ON membership.id = role_assignment.membership_id
        AND membership.id = $5 AND membership.user_id = $6
        AND membership.business_id = $2 AND membership.status = 'ACTIVE'
       WHERE reconciliation.id = $7 AND reconciliation.business_id = $2
         AND reconciliation.branch_id = $3
       FOR UPDATE OF reconciliation`,
      [
        input.actor.workAssignmentId, input.businessId, input.branchId,
        input.actor.membershipRoleId, input.actor.membershipId,
        input.actor.userId, input.id,
      ],
    );
    if (!row) throw new ReconciliationNotFoundError();
    if (row.status === input.decision) {
      if (
        row.decision_reason !== input.reason ||
        row.decided_by_role_assignment_id !== input.actor.membershipRoleId
      ) {
        throw new ReconciliationDecisionConflictError();
      }
      const replay = await this.findWithin(transaction, input.id, input);
      if (!replay) throw new ReconciliationNotFoundError();
      return { reconciliation: replay, replayed: true };
    }
    if (!['MATCHED', 'DISCREPANCY'].includes(row.status)) {
      throw new ReconciliationTransitionError();
    }
    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, previous_value, new_value,
         reason, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,$6,'RECONCILIATION',$7,
         jsonb_build_object('status',$8::text),
         jsonb_build_object('status',$9::text),$10,$11,'SUCCESS')
       RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId,
        input.decision === 'APPROVED'
          ? 'RECONCILIATION_APPROVED' : 'RECONCILIATION_RETURNED',
        input.id, row.status, input.decision, input.reason,
        input.actor.sessionId,
      ],
    );
    await transaction.one<{ id: string }>(
      `UPDATE reconciliations
       SET status = $2, decided_by_role_assignment_id = $3,
           decision_reason = $4, decided_at = now()
       WHERE id = $1 RETURNING id`,
      [input.id, input.decision, input.actor.membershipRoleId, input.reason],
    );
    await this.insertHistory(transaction, {
      reconciliationId: input.id, fromStatus: row.status,
      toStatus: input.decision,
      roleAssignmentId: input.actor.membershipRoleId!,
      reason: input.reason, auditLogId: audit.id,
    });
    const reconciliation = await this.findWithin(transaction, input.id, input);
    if (!reconciliation) throw new ReconciliationNotFoundError();
    await this.notifications.notifyReconciliationSubmitterWithin(transaction, {
      reconciliationId: input.id, status: input.decision,
    });
    await this.notifications.notifyReconciliationReviewWithin(transaction, {
      reconciliationId: input.id, businessId: input.businessId,
      branchId: input.branchId, status: input.decision,
      excludeUserId: input.actor.userId,
    });
    return { reconciliation, replayed: false };
  }

  async list(
    scope: { businessId: string; branchId?: string },
    input: {
      settlementAccountId?: string;
      status?: string;
      dateFrom?: string;
      dateTo?: string;
      limit: number;
      offset: number;
    },
  ) {
    const rows = await this.dao.many<ReconciliationRow>(
      `${this.selectSql()}
       WHERE reconciliation.business_id = $1
         AND ($2::uuid IS NULL OR reconciliation.branch_id = $2)
         AND ($3::uuid IS NULL OR reconciliation.settlement_account_id = $3)
         AND ($4::date IS NULL OR reconciliation.reconciliation_date >= $4::date)
         AND ($5::date IS NULL OR reconciliation.reconciliation_date <= $5::date)
         AND ($6::text IS NULL OR reconciliation.status = $6)
       ORDER BY reconciliation.reconciliation_date DESC,
                reconciliation.sequence_no DESC
       LIMIT $7 OFFSET $8`,
      [
        scope.businessId, scope.branchId ?? null,
        input.settlementAccountId ?? null, input.dateFrom ?? null,
        input.dateTo ?? null, input.status ?? null, input.limit, input.offset,
      ],
    );
    return rows.map((row) => this.map(row).toPublicModel());
  }

  async find(id: string, scope: { businessId: string; branchId?: string }) {
    const row = await this.dao.optional<ReconciliationRow>(
      `${this.selectSql()}
       WHERE reconciliation.id = $1 AND reconciliation.business_id = $2
         AND ($3::uuid IS NULL OR reconciliation.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  async history(id: string, scope: { businessId: string; branchId?: string }) {
    return this.dao.many<HistoryRow>(
      `SELECT history.id, history.from_status, history.to_status,
              history.reason, history.created_at
       FROM reconciliation_status_history history
       JOIN reconciliations reconciliation ON reconciliation.id = history.reconciliation_id
       WHERE reconciliation.id = $1 AND reconciliation.business_id = $2
         AND ($3::uuid IS NULL OR reconciliation.branch_id = $3)
       ORDER BY history.transition_no`,
      [id, scope.businessId, scope.branchId ?? null],
    ).then((rows) => rows.map((row) => ({
      id: row.id,
      fromStatus: row.from_status ?? undefined,
      toStatus: row.to_status,
      reason: row.reason,
      createdAt: row.created_at,
    })));
  }

  private async lockScope(
    transaction: DaoTransaction,
    input: CreateReconciliation,
  ): Promise<ScopeRow> {
    const row = await transaction.optional<ScopeRow>(
      `SELECT schedule.closing_time::text,
              (($8::date - 1 + schedule.closing_time)
                AT TIME ZONE schedule.timezone) AS period_start,
              (($8::date + schedule.closing_time)
                AT TIME ZONE schedule.timezone) AS period_end
       FROM settlement_accounts account
       JOIN reconciliation_schedules schedule
         ON schedule.business_id = $2 AND schedule.branch_id = $3
        AND schedule.scope_type = 'BRANCH' AND schedule.status = 'ACTIVE'
       JOIN user_work_assignments work
         ON work.id = $1 AND work.business_id = $2 AND work.branch_id = $3
        AND work.membership_role_id = $4 AND work.status = 'ACTIVE'
       JOIN membership_role_assignments role_assignment
         ON role_assignment.id = $4 AND role_assignment.role_code = 'CASHIER'
        AND role_assignment.status = 'ACTIVE'
       JOIN business_user_memberships membership
         ON membership.id = role_assignment.membership_id
        AND membership.id = $5 AND membership.user_id = $6
        AND membership.business_id = $2 AND membership.status = 'ACTIVE'
       WHERE account.id = $7 AND account.business_id = $2
         AND account.branch_id = $3 AND account.status = 'ACTIVE'
       FOR UPDATE OF account`,
      [
        input.actor.workAssignmentId, input.businessId, input.branchId,
        input.actor.membershipRoleId, input.actor.membershipId,
        input.actor.userId, input.settlementAccountId,
        input.reconciliationDate,
      ],
    );
    if (!row) throw new ReconciliationScheduleNotFoundError();
    return row;
  }

  private calculateTotals(
    transaction: DaoTransaction,
    input: CreateReconciliation,
    scope: ScopeRow,
  ): Promise<TotalsRow> {
    return transaction.one<TotalsRow>(
      `SELECT
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END)
           FILTER (WHERE actual_transaction_at < $2), 0)::numeric(18,2)::text
           AS opening_balance,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'VERIFIED_DEPOSIT'
           AND actual_transaction_at >= $2), 0)::numeric(18,2)::text
           AS verified_deposits_total,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'MANUAL_DEPOSIT'
           AND actual_transaction_at >= $2), 0)::numeric(18,2)::text
           AS manual_deposits_total,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'WITHDRAWAL'
           AND actual_transaction_at >= $2), 0)::numeric(18,2)::text
           AS withdrawals_total,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'POSITIVE_CORRECTION'
           AND actual_transaction_at >= $2), 0)::numeric(18,2)::text
           AS positive_corrections_total,
         COALESCE(SUM(amount) FILTER (WHERE entry_type = 'NEGATIVE_CORRECTION'
           AND actual_transaction_at >= $2), 0)::numeric(18,2)::text
           AS negative_corrections_total,
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END)
           FILTER (WHERE entry_type = 'REVERSAL' AND actual_transaction_at >= $2),
           0)::numeric(18,2)::text AS reversals_net_total,
         COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END),
           0)::numeric(18,2)::text AS calculated_balance,
         ($4::numeric(18,2) - COALESCE(SUM(
           CASE WHEN direction = 'CREDIT' THEN amount ELSE -amount END), 0))
           ::numeric(18,2)::text AS difference
       FROM ledger_entries
       WHERE settlement_account_id = $1 AND actual_transaction_at < $3`,
      [
        input.settlementAccountId, scope.period_start, scope.period_end,
        input.actualBankBalance,
      ],
    );
  }

  private async findWithin(
    transaction: DaoTransaction,
    id: string,
    scope: { businessId: string; branchId?: string },
  ) {
    const row = await transaction.optional<ReconciliationRow>(
      `${this.selectSql()}
       WHERE reconciliation.id = $1 AND reconciliation.business_id = $2
         AND ($3::uuid IS NULL OR reconciliation.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  private insertHistory(
    transaction: DaoTransaction,
    input: {
      reconciliationId: string;
      fromStatus: ReconciliationStatus | null;
      toStatus: ReconciliationStatus;
      roleAssignmentId: string;
      reason: string;
      auditLogId: string;
    },
  ) {
    return transaction.one<{ id: string }>(
      `INSERT INTO reconciliation_status_history (
         reconciliation_id, from_status, to_status,
         changed_by_role_assignment_id, reason, audit_log_id, transition_no
       ) SELECT $1,$2,$3,$4,$5,$6,
           COALESCE(MAX(history.transition_no), 0) + 1
         FROM reconciliation_status_history history
         WHERE history.reconciliation_id = $1
       RETURNING id`,
      [
        input.reconciliationId, input.fromStatus, input.toStatus,
        input.roleAssignmentId, input.reason, input.auditLogId,
      ],
    );
  }

  private assertReplay(entity: ReconciliationEntity, input: CreateReconciliation) {
    const value = entity.toPublicModel();
    if (
      value.settlementAccountId !== input.settlementAccountId ||
      value.reconciliationDate !== input.reconciliationDate ||
      value.actualBankBalance !== input.actualBankBalance ||
      value.description !== input.description ||
      value.differenceExplanation !== input.differenceExplanation
    ) {
      throw new ReconciliationReplayConflictError();
    }
  }

  private selectSql(): string {
    return `SELECT reconciliation.id, reconciliation.business_id,
                   reconciliation.branch_id, reconciliation.settlement_account_id,
                   to_char(reconciliation.reconciliation_date, 'YYYY-MM-DD')
                     AS reconciliation_date,
                   reconciliation.closing_time::text,
                   reconciliation.opening_balance::text,
                   reconciliation.verified_deposits_total::text,
                   reconciliation.manual_deposits_total::text,
                   reconciliation.withdrawals_total::text,
                   reconciliation.positive_corrections_total::text,
                   reconciliation.negative_corrections_total::text,
                   reconciliation.reversals_net_total::text,
                   reconciliation.calculated_balance::text,
                   reconciliation.actual_bank_balance::text,
                   reconciliation.difference::text, reconciliation.description,
                   reconciliation.difference_explanation, reconciliation.status,
                   reconciliation.sequence_no, reconciliation.submitted_at,
                   reconciliation.decision_reason, reconciliation.decided_at,
                   reconciliation.created_at
            FROM reconciliations reconciliation`;
  }

  private map(row: ReconciliationRow): ReconciliationEntity {
    const props: ReconciliationProps = {
      id: row.id, businessId: row.business_id, branchId: row.branch_id,
      settlementAccountId: row.settlement_account_id,
      reconciliationDate: row.reconciliation_date,
      closingTime: row.closing_time,
      openingBalance: row.opening_balance,
      verifiedDepositsTotal: row.verified_deposits_total,
      manualDepositsTotal: row.manual_deposits_total,
      withdrawalsTotal: row.withdrawals_total,
      positiveCorrectionsTotal: row.positive_corrections_total,
      negativeCorrectionsTotal: row.negative_corrections_total,
      reversalsNetTotal: row.reversals_net_total,
      calculatedBalance: row.calculated_balance,
      actualBankBalance: row.actual_bank_balance,
      difference: row.difference, description: row.description,
      differenceExplanation: row.difference_explanation ?? undefined,
      status: row.status, sequenceNo: row.sequence_no,
      submittedAt: row.submitted_at ?? undefined, createdAt: row.created_at,
      decisionReason: row.decision_reason ?? undefined,
      decidedAt: row.decided_at ?? undefined,
    };
    return new ReconciliationEntity(props);
  }
}
