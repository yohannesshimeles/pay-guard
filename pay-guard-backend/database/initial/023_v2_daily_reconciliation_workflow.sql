-- Phase 6 daily reconciliation snapshots and allow-listed workflow transitions.

DROP TRIGGER IF EXISTS trg_reconciliation_immutable ON reconciliations;

ALTER TABLE reconciliations
  DROP CONSTRAINT IF EXISTS reconciliations_status_check;

UPDATE reconciliations SET status = 'DISCREPANCY' WHERE status = 'UNMATCHED';
UPDATE reconciliations SET status = 'APPROVED' WHERE status = 'CORRECTED';

ALTER TABLE reconciliations
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN reversals_net_total numeric(18,2) NOT NULL DEFAULT 0,
  ADD COLUMN decided_by_role_assignment_id uuid REFERENCES membership_role_assignments(id),
  ADD COLUMN decision_reason text,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ALTER COLUMN submitted_at DROP NOT NULL,
  ALTER COLUMN submitted_at DROP DEFAULT,
  ADD CONSTRAINT reconciliations_status_check CHECK (status IN (
    'DRAFT','SUBMITTED','MATCHED','DISCREPANCY','APPROVED','RETURNED',
    'SUPERSEDED','ARCHIVED'
  )),
  ADD CONSTRAINT ck_reconciliation_decision CHECK (
    (status IN ('APPROVED','RETURNED') AND decided_by_role_assignment_id IS NOT NULL
      AND decided_at IS NOT NULL AND length(btrim(decision_reason)) >= 10)
    OR status NOT IN ('APPROVED','RETURNED')
  );

CREATE UNIQUE INDEX uq_reconciliation_business_idempotency
  ON reconciliations(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE reconciliation_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reconciliation_id uuid NOT NULL REFERENCES reconciliations(id),
  from_status varchar(20),
  to_status varchar(20) NOT NULL,
  changed_by_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  reason text NOT NULL,
  audit_log_id uuid NOT NULL REFERENCES audit_logs(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_status IS NULL OR from_status IN (
    'DRAFT','SUBMITTED','MATCHED','DISCREPANCY','APPROVED','RETURNED',
    'SUPERSEDED','ARCHIVED'
  )),
  CHECK (to_status IN (
    'DRAFT','SUBMITTED','MATCHED','DISCREPANCY','APPROVED','RETURNED',
    'SUPERSEDED','ARCHIVED'
  )),
  CHECK (length(btrim(reason)) >= 3)
);

CREATE INDEX ix_reconciliation_history
  ON reconciliation_status_history(reconciliation_id, created_at, id);

CREATE TRIGGER trg_reconciliation_history_immutable
  BEFORE UPDATE OR DELETE ON reconciliation_status_history
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();

CREATE OR REPLACE FUNCTION payguard_guard_reconciliation_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'reconciliations is immutable' USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.settlement_account_id IS DISTINCT FROM OLD.settlement_account_id
     OR NEW.reconciliation_date IS DISTINCT FROM OLD.reconciliation_date
     OR NEW.closing_time IS DISTINCT FROM OLD.closing_time
     OR NEW.opening_balance IS DISTINCT FROM OLD.opening_balance
     OR NEW.verified_deposits_total IS DISTINCT FROM OLD.verified_deposits_total
     OR NEW.manual_deposits_total IS DISTINCT FROM OLD.manual_deposits_total
     OR NEW.withdrawals_total IS DISTINCT FROM OLD.withdrawals_total
     OR NEW.positive_corrections_total IS DISTINCT FROM OLD.positive_corrections_total
     OR NEW.negative_corrections_total IS DISTINCT FROM OLD.negative_corrections_total
     OR NEW.reversals_net_total IS DISTINCT FROM OLD.reversals_net_total
     OR NEW.calculated_balance IS DISTINCT FROM OLD.calculated_balance
     OR NEW.actual_bank_balance IS DISTINCT FROM OLD.actual_bank_balance
     OR NEW.difference IS DISTINCT FROM OLD.difference
     OR NEW.description IS DISTINCT FROM OLD.description
     OR NEW.difference_explanation IS DISTINCT FROM OLD.difference_explanation
     OR NEW.sequence_no IS DISTINCT FROM OLD.sequence_no
     OR NEW.submitted_by_role_assignment_id IS DISTINCT FROM OLD.submitted_by_role_assignment_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'reconciliation financial snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'DRAFT' AND NEW.status = 'SUBMITTED') OR
    (OLD.status = 'SUBMITTED' AND NEW.status IN ('MATCHED','DISCREPANCY')) OR
    (OLD.status IN ('MATCHED','DISCREPANCY') AND NEW.status IN ('APPROVED','RETURNED')) OR
    (OLD.status = 'RETURNED' AND NEW.status = 'SUPERSEDED') OR
    (OLD.status IN ('APPROVED','SUPERSEDED') AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'invalid reconciliation status transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_reconciliation_guard
  BEFORE UPDATE OR DELETE ON reconciliations
  FOR EACH ROW EXECUTE FUNCTION payguard_guard_reconciliation_mutation();
