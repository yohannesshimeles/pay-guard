import { Injectable } from '@nestjs/common';
import { AuthenticatedPrincipal } from '../auth/auth.types';
import { DaoTransaction } from '../database/central.dao';
import { LedgerDao, LedgerPostingConflictError } from '../ledger/ledger.dao';
import { LedgerEntryEntity } from '../ledger/ledger-entry.entity';

type ReversalScopeRow = {
  original_entry_id: string;
  settlement_account_id: string;
  amount: string;
  original_direction: 'CREDIT' | 'DEBIT';
  current_balance: string;
  projected_balance: string;
  sufficient_balance: boolean;
};
type ApprovalRow = {
  id: string;
  original_ledger_entry_id: string;
  reversal_ledger_entry_id: string;
  reason: string;
  actual_transaction_at: Date;
  audit_log_id: string;
};

export type ApproveReversal = Readonly<{
  id: string;
  businessId: string;
  branchId: string;
  originalLedgerEntryId: string;
  reason: string;
  actualTransactionAt: Date;
  expectedCurrentBalance: string;
  expectedProjectedBalance: string;
  actor: AuthenticatedPrincipal;
}>;

export class ReversalScopeError extends Error {}
export class ReversalNotFoundError extends Error {}
export class ReversalAlreadyApprovedError extends Error {}
export class ReversalBalanceConflictError extends Error {}
export class ReversalInsufficientBalanceError extends Error {}
export class ReversalReplayConflictError extends Error {}

@Injectable()
export class ReversalApprovalDao {
  constructor(private readonly ledger: LedgerDao) {}

  async approveWithin(transaction: DaoTransaction, input: ApproveReversal) {
    const scope = await this.lockScope(transaction, input);
    const existing = await transaction.optional<ApprovalRow>(
      `SELECT id, original_ledger_entry_id, reversal_ledger_entry_id,
              reason, actual_transaction_at, audit_log_id
       FROM ledger_reversal_approvals WHERE id = $1 FOR UPDATE`,
      [input.id],
    );
    if (existing) {
      this.assertReplay(existing, input);
      const replay = await this.reverse(transaction, input, existing.audit_log_id);
      return { approvalId: existing.id, reversal: replay.entry, replayed: true };
    }
    const prior = await transaction.optional<{ id: string }>(
      `SELECT id FROM ledger_entries
       WHERE reversal_of_entry_id = $1 FOR UPDATE`,
      [input.originalLedgerEntryId],
    );
    if (prior) throw new ReversalAlreadyApprovedError();
    if (
      scope.current_balance !== input.expectedCurrentBalance ||
      scope.projected_balance !== input.expectedProjectedBalance
    ) {
      throw new ReversalBalanceConflictError();
    }
    if (!scope.sufficient_balance) throw new ReversalInsufficientBalanceError();

    const audit = await transaction.one<{ id: string }>(
      `INSERT INTO audit_logs (
         user_id, membership_id, role_code, business_id, branch_id,
         action_type, record_type, record_id, previous_value, new_value,
         reason, session_id, result
       ) VALUES ($1,$2,$3,$4,$5,'LEDGER_REVERSAL_APPROVED',
         'LEDGER_REVERSAL_APPROVAL',$6,
         jsonb_build_object('originalLedgerEntryId',$7::text,
                            'direction',$8::text,'amount',$9::text),
         jsonb_build_object('projectedBalance',$10::text),$11,$12,'SUCCESS')
       RETURNING id`,
      [
        input.actor.userId, input.actor.membershipId, input.actor.role,
        input.businessId, input.branchId, input.id,
        input.originalLedgerEntryId, scope.original_direction, scope.amount,
        scope.projected_balance, input.reason, input.actor.sessionId,
      ],
    );
    const reversed = await this.reverse(transaction, input, audit.id);
    await transaction.one<{ id: string }>(
      `INSERT INTO ledger_reversal_approvals (
         id, business_id, branch_id, original_ledger_entry_id,
         reversal_ledger_entry_id, reason, actual_transaction_at,
         approved_by_role_assignment_id, audit_log_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        input.id, input.businessId, input.branchId,
        input.originalLedgerEntryId, reversed.entry.id, input.reason,
        input.actualTransactionAt, input.actor.membershipRoleId, audit.id,
      ],
    );
    return { approvalId: input.id, reversal: reversed.entry, replayed: false };
  }

  private async lockScope(
    transaction: DaoTransaction,
    input: ApproveReversal,
  ): Promise<ReversalScopeRow> {
    const row = await transaction.optional<ReversalScopeRow>(
      `SELECT original.id AS original_entry_id,
              original.settlement_account_id, original.amount::text,
              original.direction AS original_direction,
              account.calculated_balance::text AS current_balance,
              (account.calculated_balance +
                CASE WHEN original.direction = 'CREDIT' THEN -original.amount
                     ELSE original.amount END)::text AS projected_balance,
              (original.direction = 'DEBIT' OR
               account.calculated_balance >= original.amount) AS sufficient_balance
       FROM ledger_entries original
       JOIN settlement_accounts account
         ON account.id = original.settlement_account_id
        AND account.business_id = $2 AND account.branch_id = $3
        AND account.status = 'ACTIVE'
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
       WHERE original.id = $7 AND original.business_id = $2
         AND original.branch_id = $3 AND original.entry_type <> 'REVERSAL'
       FOR UPDATE OF original, account`,
      [
        input.actor.workAssignmentId, input.businessId, input.branchId,
        input.actor.membershipRoleId, input.actor.membershipId,
        input.actor.userId, input.originalLedgerEntryId,
      ],
    );
    if (!row) throw new ReversalNotFoundError();
    return row;
  }

  private reverse(
    transaction: DaoTransaction,
    input: ApproveReversal,
    auditLogId: string,
  ) {
    return this.ledger.reverseWithin(transaction, {
      businessId: input.businessId,
      branchId: input.branchId,
      originalEntryId: input.originalLedgerEntryId,
      actualTransactionAt: input.actualTransactionAt,
      sourceRecordType: 'LEDGER_REVERSAL_APPROVAL',
      sourceRecordId: input.id,
      description: input.reason,
      createdByUserId: input.actor.userId,
      workAssignmentId: input.actor.workAssignmentId,
      auditLogId,
      idempotencyKey: `reversal-approval:${input.id}`,
    }).catch((error: unknown) => {
      if (error instanceof LedgerPostingConflictError) {
        throw new ReversalReplayConflictError();
      }
      throw error;
    });
  }

  private assertReplay(row: ApprovalRow, input: ApproveReversal): void {
    if (
      row.original_ledger_entry_id !== input.originalLedgerEntryId ||
      row.reason !== input.reason ||
      row.actual_transaction_at.getTime() !== input.actualTransactionAt.getTime()
    ) {
      throw new ReversalReplayConflictError();
    }
  }
}

export function reversalPublicModel(
  approvalId: string,
  entry: LedgerEntryEntity,
) {
  return {
    approvalId,
    originalLedgerEntryId: entry.reversalOfEntryId,
    reversalLedgerEntryId: entry.id,
    settlementAccountId: entry.settlementAccountId,
    direction: entry.direction,
    currency: 'ETB' as const,
    amount: entry.amount,
    runningBalance: entry.runningBalance,
    actualTransactionAt: entry.actualTransactionAt,
    createdAt: entry.createdAt,
  };
}
