import { Injectable } from '@nestjs/common';
import { CentralDao } from '../database/central.dao';
import { LedgerEntryType } from '../ledger/ledger-entry-type.enum';

export type FinancialReportScope = Readonly<{
  businessId: string;
  branchId?: string;
}>;

type FinancialCategoryRow = {
  entryType: LedgerEntryType;
  entryCount: number;
  creditTotal: string;
  debitTotal: string;
  netTotal: string;
};

type FinancialSummaryRow = {
  entry_count: string;
  credit_total: string;
  debit_total: string;
  net_total: string;
  categories: FinancialCategoryRow[];
};

@Injectable()
export class FinancialReportDao {
  constructor(private readonly dao: CentralDao) {}

  async summary(scope: FinancialReportScope, input: {
    branchId?: string;
    settlementAccountId?: string;
    dateFrom: string;
    dateTo: string;
  }) {
    const branchId = scope.branchId ?? input.branchId ?? null;
    const row = await this.dao.one<FinancialSummaryRow>(
      `WITH scoped AS (
         SELECT entry.entry_type, entry.direction, entry.amount
         FROM ledger_entries entry
         WHERE entry.business_id = $1
           AND ($2::uuid IS NULL OR entry.branch_id = $2)
           AND ($3::uuid IS NULL OR entry.settlement_account_id = $3)
           AND entry.actual_transaction_at >= $4::date
           AND entry.actual_transaction_at < $5::date + interval '1 day'
       ), categories AS (
         SELECT entry_type,
                COUNT(*)::integer AS entry_count,
                COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text
                  AS credit_total,
                COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text
                  AS debit_total,
                COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount
                                  ELSE -amount END), 0)::text AS net_total
         FROM scoped GROUP BY entry_type
       ), overall AS (
         SELECT COUNT(*)::text AS entry_count,
                COALESCE(SUM(amount) FILTER (WHERE direction = 'CREDIT'), 0)::text
                  AS credit_total,
                COALESCE(SUM(amount) FILTER (WHERE direction = 'DEBIT'), 0)::text
                  AS debit_total,
                COALESCE(SUM(CASE WHEN direction = 'CREDIT' THEN amount
                                  ELSE -amount END), 0)::text AS net_total
         FROM scoped
       )
       SELECT overall.entry_count, overall.credit_total, overall.debit_total,
              overall.net_total,
              COALESCE((
                SELECT jsonb_agg(jsonb_build_object(
                  'entryType', category.entry_type,
                  'entryCount', category.entry_count,
                  'creditTotal', category.credit_total,
                  'debitTotal', category.debit_total,
                  'netTotal', category.net_total
                ) ORDER BY category.entry_type)
                FROM categories category
              ), '[]'::jsonb) AS categories
       FROM overall`,
      [scope.businessId, branchId, input.settlementAccountId ?? null,
       input.dateFrom, input.dateTo],
    );
    return {
      businessId: scope.businessId,
      branchId: branchId ?? undefined,
      settlementAccountId: input.settlementAccountId,
      dateFrom: input.dateFrom,
      dateTo: input.dateTo,
      currency: 'ETB' as const,
      entryCount: Number(row.entry_count),
      creditTotal: row.credit_total,
      debitTotal: row.debit_total,
      netTotal: row.net_total,
      categories: row.categories,
    };
  }
}
