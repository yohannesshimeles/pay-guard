import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { LedgerDao } from '../ledger/ledger.dao';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';
import { LedgerEntryType } from '../ledger/ledger-entry-type.enum';
import { CorrectionEntity, CorrectionProps } from './correction.entity';
import { CorrectionType } from './dto/financial-operation.dto';

type ScopeRow = {
  current_balance: string;
  projected_balance: string;
  sufficient_balance: boolean;
  evidence_valid: boolean;
};
type CorrectionRow = {
  id: string;
  business_id: string;
  branch_id: string;
  settlement_account_id: string;
  correction_type: CorrectionType;
  amount: string;
  reason: string;
  actual_transaction_at: Date;
  source_reconciliation_id: string | null;
  ledger_entry_id: string;
  running_balance: string;
  status: 'POSTED';
  created_at: Date;
};

export type CreateCorrection = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  correctionType: CorrectionType;
  amount: string;
  reason: string;
  actualTransactionAt: Date;
  sourceReconciliationId?: string;
  expectedCurrentBalance: string;
  expectedProjectedBalance: string;
  actor: AuthenticatedPrincipal;
}>;

export class CorrectionScopeError extends Error {}
export class CorrectionEvidenceError extends Error {}
export class CorrectionBalanceConflictError extends Error {}
export class CorrectionInsufficientBalanceError extends Error {}
export class CorrectionReplayConflictError extends Error {}
export class CorrectionNotFoundError extends Error {}

@Injectable()
export class CorrectionDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly ledger: LedgerDao,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  async createWithin(transaction: DaoTransaction, input: CreateCorrection) {
    const scope = await this.lockScope(transaction, input);
    const existing = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (existing) {
      this.assertReplay(existing, input);
      return { correction: existing, replayed: true };
    }
    if (!scope.evidence_valid) throw new CorrectionEvidenceError();
    if (
      scope.current_balance !== input.expectedCurrentBalance ||
      scope.projected_balance !== input.expectedProjectedBalance
    ) {
      throw new CorrectionBalanceConflictError();
    }
    if (!scope.sufficient_balance) throw new CorrectionInsufficientBalanceError();

    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, new_value, reason, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,'BALANCE_CORRECTION_CREATED','BALANCE_CORRECTION',$6,
         jsonb_build_object('settlementAccountId',$7::text,'correctionType',$8::text,
                            'amount',$9::text,'sourceReconciliationId',$10::text,
                            'actualTransactionAt',$11::text),$12,$13,'SUCCESS')
       RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId, input.id, input.settlementAccountId,
        input.correctionType, input.amount, input.sourceReconciliationId ?? null,
        input.actualTransactionAt.toISOString(), input.reason,
        input.actor.sessionId,
      ],
    );
    const posted = await this.ledger.postWithin(transaction, {
      businessId: input.businessId,
      branchId: input.branchId,
      settlementAccountId: input.settlementAccountId,
      entryType: input.correctionType === CorrectionType.POSITIVE
        ? LedgerEntryType.POSITIVE_CORRECTION
        : LedgerEntryType.NEGATIVE_CORRECTION,
      amount: input.amount,
      actualTransactionAt: input.actualTransactionAt,
      sourceRecordType: 'BALANCE_CORRECTION',
      sourceRecordId: input.id,
      description: input.reason,
      createdByUserId: input.actor.userId,
      workAssignmentId: input.actor.workAssignmentId,
      auditLogId: audit.id,
      idempotencyKey: `correction:${input.id}`,
    });
    await transaction.one<{ id: string }>(
      `INSERT INTO balance_corrections (
         id, business_id, branch_id, settlement_account_id, correction_type,
         amount, reason, actual_transaction_at, recorded_by_role_assignment_id,
         source_reconciliation_id, ledger_entry_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$1)
       RETURNING id`,
      [
        input.id, input.businessId, input.branchId, input.settlementAccountId,
        input.correctionType, input.amount, input.reason,
        input.actualTransactionAt, input.actor.membershipRoleId,
        input.sourceReconciliationId ?? null, posted.entry.id,
      ],
    );
    const correction = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (!correction) throw new CorrectionNotFoundError();
    await this.notifications.notifyFinancialOversightWithin(transaction, {
      operation: 'CORRECTION', recordId: input.id,
      businessId: input.businessId, branchId: input.branchId,
      excludeUserId: input.actor.userId,
    });
    return { correction, replayed: false };
  }

  async list(
    scope: { businessId: string; branchId?: string },
    input: {
      settlementAccountId?: string;
      dateFrom?: string;
      dateTo?: string;
      limit: number;
      offset: number;
    },
  ) {
    const rows = await this.dao.many<CorrectionRow>(
      `${this.selectSql()}
       WHERE correction.business_id = $1
         AND ($2::uuid IS NULL OR correction.branch_id = $2)
         AND ($3::uuid IS NULL OR correction.settlement_account_id = $3)
         AND ($4::date IS NULL OR correction.actual_transaction_at >= $4::date)
         AND ($5::date IS NULL OR correction.actual_transaction_at < $5::date + interval '1 day')
       ORDER BY correction.actual_transaction_at DESC, correction.id DESC
       LIMIT $6 OFFSET $7`,
      [
        scope.businessId, scope.branchId ?? null,
        input.settlementAccountId ?? null, input.dateFrom ?? null,
        input.dateTo ?? null, input.limit, input.offset,
      ],
    );
    return rows.map((row) => this.map(row).toPublicModel());
  }

  async find(id: string, scope: { businessId: string; branchId?: string }) {
    const row = await this.dao.optional<CorrectionRow>(
      `${this.selectSql()}
       WHERE correction.id = $1 AND correction.business_id = $2
         AND ($3::uuid IS NULL OR correction.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  private async lockScope(
    transaction: DaoTransaction,
    input: CreateCorrection,
  ): Promise<ScopeRow> {
    const row = await transaction.optional<ScopeRow>(
      `SELECT account.calculated_balance::text AS current_balance,
              (account.calculated_balance +
                CASE WHEN $8 = 'POSITIVE' THEN $9::numeric(18,2)
                     ELSE -$9::numeric(18,2) END)::text AS projected_balance,
              ($8 = 'POSITIVE' OR account.calculated_balance >= $9::numeric(18,2))
                AS sufficient_balance,
              ($10::uuid IS NULL OR EXISTS (
                SELECT 1 FROM reconciliations reconciliation
                WHERE reconciliation.id = $10 AND reconciliation.business_id = $2
                  AND reconciliation.branch_id = $3
                  AND reconciliation.settlement_account_id = account.id
              )) AS evidence_valid
       FROM settlement_accounts account
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
       WHERE account.id = $7 AND account.business_id = $2
         AND account.branch_id = $3 AND account.status = 'ACTIVE'
       FOR UPDATE OF account`,
      [
        input.actor.workAssignmentId, input.businessId, input.branchId,
        input.actor.membershipRoleId, input.actor.membershipId,
        input.actor.userId, input.settlementAccountId, input.correctionType,
        input.amount, input.sourceReconciliationId ?? null,
      ],
    );
    if (!row) throw new CorrectionScopeError();
    return row;
  }

  private async findWithin(
    transaction: DaoTransaction,
    id: string,
    scope: { businessId: string; branchId?: string },
  ) {
    const row = await transaction.optional<CorrectionRow>(
      `${this.selectSql()}
       WHERE correction.id = $1 AND correction.business_id = $2
         AND ($3::uuid IS NULL OR correction.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  private assertReplay(entity: CorrectionEntity, input: CreateCorrection) {
    const value = entity.toPublicModel();
    if (
      value.settlementAccountId !== input.settlementAccountId ||
      value.correctionType !== input.correctionType ||
      value.amount !== input.amount || value.reason !== input.reason ||
      value.sourceReconciliationId !== input.sourceReconciliationId ||
      value.actualTransactionAt.getTime() !== input.actualTransactionAt.getTime()
    ) {
      throw new CorrectionReplayConflictError();
    }
  }

  private selectSql(): string {
    return `SELECT correction.id, correction.business_id, correction.branch_id,
                   correction.settlement_account_id, correction.correction_type,
                   correction.amount::text, correction.reason,
                   correction.actual_transaction_at,
                   correction.source_reconciliation_id,
                   correction.ledger_entry_id, ledger.running_balance::text,
                   correction.status, correction.created_at
            FROM balance_corrections correction
            JOIN ledger_entries ledger ON ledger.id = correction.ledger_entry_id`;
  }

  private map(row: CorrectionRow): CorrectionEntity {
    const props: CorrectionProps = {
      id: row.id, businessId: row.business_id, branchId: row.branch_id,
      settlementAccountId: row.settlement_account_id,
      correctionType: row.correction_type, amount: row.amount,
      reason: row.reason, actualTransactionAt: row.actual_transaction_at,
      sourceReconciliationId: row.source_reconciliation_id ?? undefined,
      ledgerEntryId: row.ledger_entry_id, runningBalance: row.running_balance,
      status: row.status, createdAt: row.created_at,
    };
    return new CorrectionEntity(props);
  }
}
