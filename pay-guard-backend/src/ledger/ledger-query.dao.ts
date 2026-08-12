import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { LedgerDirection, LedgerEntryType } from './ledger-entry-type.enum';

export type LedgerQueryScope = Readonly<{
  businessId: string;
  branchId?: string;
}>;

type LedgerQueryRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  settlement_account_id: string;
  entry_type: LedgerEntryType;
  direction: LedgerDirection;
  amount: string;
  running_balance: string;
  actual_transaction_at: Date;
  description: string | null;
  created_by_user_id: string | null;
  reversal_of_entry_id: string | null;
  created_at: Date;
};

type ProjectedBalanceRow = {
  settlement_account_id: string;
  branch_id: string | null;
  current_balance: string;
  projected_balance: string;
};

@Injectable()
export class LedgerQueryDao {
  constructor(private readonly dao: CentralDao) {}

  async list(
    scope: LedgerQueryScope,
    input: {
      branchId?: string;
      settlementAccountId?: string;
      entryType?: LedgerEntryType;
      dateFrom?: string;
      dateTo?: string;
      limit: number;
      offset: number;
    },
  ) {
    const rows = await this.dao.many<LedgerQueryRow>(
      `${this.selectSql()}
       WHERE entry.business_id = $1
         AND ($2::uuid IS NULL OR entry.branch_id = $2)
         AND ($3::uuid IS NULL OR entry.settlement_account_id = $3)
         AND ($4::varchar IS NULL OR entry.entry_type = $4)
         AND ($5::date IS NULL OR entry.actual_transaction_at >= $5::date)
         AND ($6::date IS NULL OR entry.actual_transaction_at < $6::date + interval '1 day')
       ORDER BY entry.actual_transaction_at DESC, entry.id DESC
       LIMIT $7 OFFSET $8`,
      [
        scope.businessId, scope.branchId ?? input.branchId ?? null,
        input.settlementAccountId ?? null, input.entryType ?? null,
        input.dateFrom ?? null, input.dateTo ?? null, input.limit, input.offset,
      ],
    );
    return rows.map((row) => this.map(row));
  }

  async find(id: string, scope: LedgerQueryScope) {
    const row = await this.dao.optional<LedgerQueryRow>(
      `${this.selectSql()}
       WHERE entry.id = $1 AND entry.business_id = $2
         AND ($3::uuid IS NULL OR entry.branch_id = $3)`,
      [id, scope.businessId, scope.branchId ?? null],
    );
    return row ? this.map(row) : undefined;
  }

  async projectedBalance(
    accountId: string,
    scope: LedgerQueryScope,
    input: { direction: LedgerDirection; amount: string },
  ) {
    const row = await this.dao.optional<ProjectedBalanceRow>(
      `SELECT account.id AS settlement_account_id, account.branch_id,
              account.calculated_balance::text AS current_balance,
              (account.calculated_balance +
                CASE WHEN $4 = 'CREDIT' THEN $5::numeric(18,2)
                     ELSE -$5::numeric(18,2) END)::text AS projected_balance
       FROM settlement_accounts account
       WHERE account.id = $1 AND account.business_id = $2
         AND ($3::uuid IS NULL OR account.branch_id = $3)
         AND account.status = 'ACTIVE'`,
      [accountId, scope.businessId, scope.branchId ?? null,
       input.direction, input.amount],
    );
    return row ? {
      settlementAccountId: row.settlement_account_id,
      branchId: row.branch_id ?? undefined,
      currency: 'ETB' as const,
      direction: input.direction,
      amount: input.amount,
      currentBalance: row.current_balance,
      projectedBalance: row.projected_balance,
    } : undefined;
  }

  private selectSql(): string {
    return `SELECT entry.id, entry.business_id, entry.branch_id,
                   entry.settlement_account_id, entry.entry_type, entry.direction,
                   entry.amount::text, entry.running_balance::text,
                   entry.actual_transaction_at, entry.description,
                   entry.created_by_user_id, entry.reversal_of_entry_id,
                   entry.created_at
            FROM ledger_entries entry`;
  }

  private map(row: LedgerQueryRow) {
    return {
      id: row.id, businessId: row.business_id,
      branchId: row.branch_id ?? undefined,
      settlementAccountId: row.settlement_account_id,
      entryType: row.entry_type, direction: row.direction, amount: row.amount,
      runningBalance: row.running_balance,
      actualTransactionAt: row.actual_transaction_at,
      description: row.description ?? undefined,
      createdByUserId: row.created_by_user_id ?? undefined,
      reversalOfEntryId: row.reversal_of_entry_id ?? undefined,
      createdAt: row.created_at,
    };
  }
}
