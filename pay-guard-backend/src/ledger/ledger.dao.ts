import { Injectable } from '@nestjs/common';
import { DaoTransaction } from '../database/central.dao';
import { LedgerEntryEntity } from './ledger-entry.entity';
import {
  LedgerDirection,
  LedgerEntryType,
} from './ledger-entry-type.enum';

type AccountRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  calculated_balance: string;
};

type LedgerRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  settlement_account_id: string;
  entry_type: LedgerEntryType;
  direction: LedgerDirection;
  amount: string;
  running_balance: string;
  actual_transaction_at: Date;
  source_record_type: string;
  source_record_id: string;
  description: string | null;
  created_by_user_id: string | null;
  work_assignment_id: string | null;
  audit_log_id: string | null;
  reversal_of_entry_id: string | null;
  idempotency_key: string | null;
  created_at: Date;
};

export type PostLedgerEntry = Readonly<{
  businessId: string;
  branchId?: string;
  settlementAccountId: string;
  entryType: Exclude<LedgerEntryType, LedgerEntryType.REVERSAL>;
  amount: string;
  actualTransactionAt: Date;
  sourceRecordType: string;
  sourceRecordId: string;
  description: string;
  createdByUserId?: string;
  workAssignmentId?: string;
  auditLogId: string;
  idempotencyKey: string;
}>;

export type ReverseLedgerEntry = Readonly<{
  businessId: string;
  branchId?: string;
  originalEntryId: string;
  actualTransactionAt: Date;
  sourceRecordType: string;
  sourceRecordId: string;
  description: string;
  createdByUserId?: string;
  workAssignmentId?: string;
  auditLogId: string;
  idempotencyKey: string;
}>;

export type PostedLedgerEntry = Readonly<{
  entry: LedgerEntryEntity;
  replayed: boolean;
}>;

type InternalPostLedgerEntry = Omit<PostLedgerEntry, 'entryType'> & {
  entryType: LedgerEntryType;
  direction: LedgerDirection;
  reversalOfEntryId?: string;
};

export class LedgerPostingConflictError extends Error {
  readonly name = 'LedgerPostingConflictError';
}

export class LedgerAccountNotFoundError extends Error {
  readonly name = 'LedgerAccountNotFoundError';
}

export class LedgerEntryNotFoundError extends Error {
  readonly name = 'LedgerEntryNotFoundError';
}

@Injectable()
export class LedgerDao {
  async postWithin(
    transaction: DaoTransaction,
    input: PostLedgerEntry,
  ): Promise<PostedLedgerEntry> {
    const direction = this.direction(input.entryType);
    return this.postLocked(transaction, {
      ...input,
      direction,
    });
  }

  async reverseWithin(
    transaction: DaoTransaction,
    input: ReverseLedgerEntry,
  ): Promise<PostedLedgerEntry> {
    const original = await transaction.optional<LedgerRow>(
      `${this.selectSql()}
       WHERE entry.id = $1 AND entry.business_id = $2
         AND ($3::uuid IS NULL OR entry.branch_id = $3)
       FOR UPDATE OF entry`,
      [input.originalEntryId, input.businessId, input.branchId ?? null],
    );
    if (!original) throw new LedgerEntryNotFoundError();
    return this.postLocked(transaction, {
      ...input,
      settlementAccountId: original.settlement_account_id,
      entryType: LedgerEntryType.REVERSAL,
      direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
      amount: original.amount,
      reversalOfEntryId: original.id,
    });
  }

  private async postLocked(
    transaction: DaoTransaction,
    input: InternalPostLedgerEntry,
  ): Promise<PostedLedgerEntry> {
    const account = await transaction.optional<AccountRow>(
      `SELECT id, business_id, branch_id, calculated_balance::text
       FROM settlement_accounts
       WHERE id = $1 AND business_id = $2
         AND ($3::uuid IS NULL OR branch_id = $3)
         AND status = 'ACTIVE'
       FOR UPDATE`,
      [input.settlementAccountId, input.businessId, input.branchId ?? null],
    );
    if (!account) throw new LedgerAccountNotFoundError();

    const existing = await transaction.optional<LedgerRow>(
      `${this.selectSql()}
       WHERE entry.business_id = $1 AND entry.idempotency_key = $2
       FOR UPDATE OF entry`,
      [input.businessId, input.idempotencyKey],
    );
    if (existing) {
      this.assertReplay(existing, input);
      return { entry: this.map(existing), replayed: true };
    }

    const balance = await transaction.one<{ calculated_balance: string }>(
      `UPDATE settlement_accounts
       SET calculated_balance = calculated_balance +
         CASE WHEN $2 = 'CREDIT' THEN $3::numeric(18,2)
              ELSE -$3::numeric(18,2) END,
           last_activity_at = now()
       WHERE id = $1
       RETURNING calculated_balance::text`,
      [account.id, input.direction, input.amount],
    );
    const inserted = await transaction.one<LedgerRow>(
      `INSERT INTO ledger_entries (
         business_id, branch_id, settlement_account_id, entry_type, direction,
         amount, running_balance, actual_transaction_at, source_record_type,
         source_record_id, description, created_by_user_id, work_assignment_id,
         audit_log_id, reversal_of_entry_id, idempotency_key
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       RETURNING id, business_id, branch_id, settlement_account_id, entry_type,
                 direction, amount::text, running_balance::text,
                 actual_transaction_at, source_record_type, source_record_id,
                 description, created_by_user_id, work_assignment_id,
                 audit_log_id, reversal_of_entry_id, idempotency_key, created_at`,
      [
        input.businessId, account.branch_id, account.id, input.entryType,
        input.direction, input.amount, balance.calculated_balance,
        input.actualTransactionAt, input.sourceRecordType, input.sourceRecordId,
        input.description, input.createdByUserId ?? null,
        input.workAssignmentId ?? null, input.auditLogId,
        input.reversalOfEntryId ?? null, input.idempotencyKey,
      ],
    );
    return { entry: this.map(inserted), replayed: false };
  }

  private assertReplay(
    row: LedgerRow,
    input: InternalPostLedgerEntry,
  ): void {
    if (
      row.settlement_account_id !== input.settlementAccountId ||
      row.entry_type !== input.entryType || row.direction !== input.direction ||
      row.amount !== input.amount || row.source_record_type !== input.sourceRecordType ||
      row.source_record_id !== input.sourceRecordId ||
      row.reversal_of_entry_id !== (input.reversalOfEntryId ?? null)
    ) {
      throw new LedgerPostingConflictError();
    }
  }

  private direction(entryType: Exclude<LedgerEntryType, LedgerEntryType.REVERSAL>) {
    return [LedgerEntryType.WITHDRAWAL, LedgerEntryType.NEGATIVE_CORRECTION]
      .includes(entryType)
      ? 'DEBIT' as const
      : 'CREDIT' as const;
  }

  private selectSql(): string {
    return `SELECT entry.id, entry.business_id, entry.branch_id,
                   entry.settlement_account_id, entry.entry_type, entry.direction,
                   entry.amount::text, entry.running_balance::text,
                   entry.actual_transaction_at, entry.source_record_type,
                   entry.source_record_id, entry.description,
                   entry.created_by_user_id, entry.work_assignment_id,
                   entry.audit_log_id, entry.reversal_of_entry_id,
                   entry.idempotency_key, entry.created_at
            FROM ledger_entries entry`;
  }

  private map(row: LedgerRow): LedgerEntryEntity {
    return new LedgerEntryEntity({
      id: row.id, businessId: row.business_id,
      branchId: row.branch_id ?? undefined,
      settlementAccountId: row.settlement_account_id,
      entryType: row.entry_type, direction: row.direction, amount: row.amount,
      runningBalance: row.running_balance,
      actualTransactionAt: row.actual_transaction_at,
      sourceRecordType: row.source_record_type, sourceRecordId: row.source_record_id,
      description: row.description ?? undefined,
      createdByUserId: row.created_by_user_id ?? undefined,
      workAssignmentId: row.work_assignment_id ?? undefined,
      auditLogId: row.audit_log_id ?? undefined,
      reversalOfEntryId: row.reversal_of_entry_id ?? undefined,
      idempotencyKey: row.idempotency_key ?? undefined,
      createdAt: row.created_at,
    });
  }
}
