-- Phase 5 Manager corrections and explicit compensating-reversal approvals.

ALTER TABLE balance_corrections
  RENAME COLUMN cashier_role_assignment_id TO recorded_by_role_assignment_id;

ALTER TABLE balance_corrections
  ADD COLUMN idempotency_key uuid;

CREATE UNIQUE INDEX uq_correction_business_idempotency
  ON balance_corrections(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_correction_branch_actual_at
  ON balance_corrections(business_id, branch_id, actual_transaction_at DESC);

CREATE TABLE ledger_reversal_approvals (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  original_ledger_entry_id uuid NOT NULL UNIQUE REFERENCES ledger_entries(id),
  reversal_ledger_entry_id uuid NOT NULL UNIQUE REFERENCES ledger_entries(id),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  actual_transaction_at timestamptz NOT NULL,
  approved_by_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  audit_log_id uuid NOT NULL REFERENCES audit_logs(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_reversal_approval_branch_created
  ON ledger_reversal_approvals(business_id, branch_id, created_at DESC);

CREATE TRIGGER trg_reversal_approval_immutable
  BEFORE UPDATE OR DELETE ON ledger_reversal_approvals
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
