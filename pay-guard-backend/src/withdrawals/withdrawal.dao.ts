import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { CentralDao, DaoTransaction } from '../database/central.dao';
import { LedgerDao } from '../ledger/ledger.dao';
import { NotificationAudienceDao } from '../notifications/notification-audience.dao';
import { LedgerEntryType } from '../ledger/ledger-entry-type.enum';
import { WithdrawalEntity, WithdrawalProps } from './withdrawal.entity';

type ScopeRow = {
  current_balance: string;
  projected_balance: string;
  sufficient_balance: boolean;
};

type WithdrawalRow = {
  id: string;
  business_id: string;
  branch_id: string;
  settlement_account_id: string;
  amount: string;
  recipient_name: string;
  recipient_bank_name: string;
  description: string;
  actual_transaction_at: Date;
  recorded_by_role_assignment_id: string;
  ledger_entry_id: string;
  running_balance: string;
  status: 'POSTED';
  created_at: Date;
};

export type CreateWithdrawal = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  settlementAccountId: string;
  amount: string;
  recipientName: string;
  recipientBankName: string;
  description: string;
  actualTransactionAt: Date;
  expectedCurrentBalance: string;
  expectedProjectedBalance: string;
  actor: AuthenticatedPrincipal;
}>;

export class WithdrawalScopeError extends Error {}
export class WithdrawalBalanceConflictError extends Error {}
export class WithdrawalInsufficientBalanceError extends Error {}
export class WithdrawalReplayConflictError extends Error {}
export class WithdrawalNotFoundError extends Error {}

@Injectable()
export class WithdrawalDao {
  constructor(
    private readonly dao: CentralDao,
    private readonly ledger: LedgerDao,
    private readonly notifications: NotificationAudienceDao,
  ) {}

  async createWithin(transaction: DaoTransaction, input: CreateWithdrawal) {
    const scope = await this.lockScope(transaction, input);
    const existing = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (existing) {
      this.assertReplay(existing, input);
      return { withdrawal: existing, replayed: true };
    }
    if (
      scope.current_balance !== input.expectedCurrentBalance ||
      scope.projected_balance !== input.expectedProjectedBalance
    ) {
      throw new WithdrawalBalanceConflictError();
    }
    if (!scope.sufficient_balance) {
      throw new WithdrawalInsufficientBalanceError();
    }

    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, new_value, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,'WITHDRAWAL_CREATED','WITHDRAWAL',$6,
         jsonb_build_object('settlementAccountId',$7::text,'amount',$8::text,
                            'recipientName',$9::text,'recipientBankName',$10::text,
                            'actualTransactionAt',$11::text),$12,'SUCCESS')
       RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId, input.id, input.settlementAccountId,
        input.amount, input.recipientName, input.recipientBankName,
        input.actualTransactionAt.toISOString(), input.actor.sessionId,
      ],
    );
    const posted = await this.ledger.postWithin(transaction, {
      businessId: input.businessId,
      branchId: input.branchId,
      settlementAccountId: input.settlementAccountId,
      entryType: LedgerEntryType.WITHDRAWAL,
      amount: input.amount,
      actualTransactionAt: input.actualTransactionAt,
      sourceRecordType: 'WITHDRAWAL',
      sourceRecordId: input.id,
      description: input.description,
      createdByUserId: input.actor.userId,
      workAssignmentId: input.actor.workAssignmentId,
      auditLogId: audit.id,
      idempotencyKey: `withdrawal:${input.id}`,
    });
    await transaction.one<{ id: string }>(
      `INSERT INTO withdrawals (
         id, business_id, branch_id, settlement_account_id, amount,
         recipient_name, recipient_bank_name, description,
         actual_transaction_at, recorded_by_role_assignment_id,
         ledger_entry_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$1)
       RETURNING id`,
      [
        input.id, input.businessId, input.branchId, input.settlementAccountId,
        input.amount, input.recipientName, input.recipientBankName,
        input.description, input.actualTransactionAt,
        input.actor.membershipRoleId, posted.entry.id,
      ],
    );
    const withdrawal = await this.findWithin(transaction, input.id, {
      businessId: input.businessId,
      branchId: input.branchId,
    });
    if (!withdrawal) throw new WithdrawalNotFoundError();
    await this.notifications.notifyFinancialOversightWithin(transaction, {
      operation: 'WITHDRAWAL', recordId: input.id,
      businessId: input.businessId, branchId: input.branchId,
    });
    return { withdrawal, replayed: false };
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
    const rows = await this.dao.many<WithdrawalRow>(
      `${this.selectSql()}
       WHERE withdrawal.business_id = $1
         AND ($2::uuid IS NULL OR withdrawal.branch_id = $2)
         AND ($3::uuid IS NULL OR withdrawal.settlement_account_id = $3)
         AND ($4::date IS NULL OR withdrawal.actual_transaction_at >= $4::date)
         AND ($5::date IS NULL OR withdrawal.actual_transaction_at < $5::date + interval '1 day')
       ORDER BY withdrawal.actual_transaction_at DESC, withdrawal.id DESC
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
    const row = await this.dao.optional<WithdrawalRow>(
      `${this.selectSql()}
       WHERE withdrawal.id = $1 AND withdrawal.business_id = $2
         AND ($3::uuid IS NULL OR withdrawal.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  private async lockScope(
    transaction: DaoTransaction,
    input: CreateWithdrawal,
  ): Promise<ScopeRow> {
    const row = await transaction.optional<ScopeRow>(
      `SELECT account.calculated_balance::text AS current_balance,
              (account.calculated_balance - $8::numeric(18,2))::text AS projected_balance,
              account.calculated_balance >= $8::numeric(18,2) AS sufficient_balance
       FROM settlement_accounts account
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
        input.actor.userId, input.settlementAccountId, input.amount,
      ],
    );
    if (!row) throw new WithdrawalScopeError();
    return row;
  }

  private async findWithin(
    transaction: DaoTransaction,
    id: string,
    scope: { businessId: string; branchId?: string },
  ) {
    const row = await transaction.optional<WithdrawalRow>(
      `${this.selectSql()}
       WHERE withdrawal.id = $1 AND withdrawal.business_id = $2
         AND ($3::uuid IS NULL OR withdrawal.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  private assertReplay(entity: WithdrawalEntity, input: CreateWithdrawal) {
    const value = entity.toPublicModel();
    if (
      value.settlementAccountId !== input.settlementAccountId ||
      value.amount !== input.amount || value.recipientName !== input.recipientName ||
      value.recipientBankName !== input.recipientBankName ||
      value.description !== input.description ||
      value.actualTransactionAt.getTime() !== input.actualTransactionAt.getTime()
    ) {
      throw new WithdrawalReplayConflictError();
    }
  }

  private selectSql(): string {
    return `SELECT withdrawal.id, withdrawal.business_id, withdrawal.branch_id,
                   withdrawal.settlement_account_id, withdrawal.amount::text,
                   withdrawal.recipient_name, withdrawal.recipient_bank_name,
                   withdrawal.description, withdrawal.actual_transaction_at,
                   withdrawal.recorded_by_role_assignment_id,
                   withdrawal.ledger_entry_id, ledger.running_balance::text,
                   withdrawal.status, withdrawal.created_at
            FROM withdrawals withdrawal
            JOIN ledger_entries ledger ON ledger.id = withdrawal.ledger_entry_id`;
  }

  private map(row: WithdrawalRow): WithdrawalEntity {
    const props: WithdrawalProps = {
      id: row.id, businessId: row.business_id, branchId: row.branch_id,
      settlementAccountId: row.settlement_account_id, amount: row.amount,
      recipientName: row.recipient_name,
      recipientBankName: row.recipient_bank_name,
      description: row.description,
      actualTransactionAt: row.actual_transaction_at,
      recordedByRoleAssignmentId: row.recorded_by_role_assignment_id,
      ledgerEntryId: row.ledger_entry_id, runningBalance: row.running_balance,
      status: row.status, createdAt: row.created_at,
    };
    return new WithdrawalEntity(props);
  }
}
