-- Phase 9: bounded, scope-aware financial summary reporting.

CREATE INDEX ix_ledger_financial_report_scope
  ON ledger_entries (
    business_id,
    branch_id,
    actual_transaction_at,
    entry_type
  );
