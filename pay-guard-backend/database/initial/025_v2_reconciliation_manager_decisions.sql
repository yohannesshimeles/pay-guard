-- Phase 6 Manager reconciliation decisions: decision metadata may only be
-- written atomically with an allow-listed MATCHED/DISCREPANCY decision.

CREATE OR REPLACE FUNCTION payguard_guard_reconciliation_decision_metadata()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status NOT IN ('APPROVED','RETURNED') AND (
      NEW.decided_by_role_assignment_id IS NOT NULL OR
      NEW.decision_reason IS NOT NULL OR NEW.decided_at IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'reconciliation decision metadata requires a decision state'
        USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.decided_by_role_assignment_id IS DISTINCT FROM OLD.decided_by_role_assignment_id
     OR NEW.decision_reason IS DISTINCT FROM OLD.decision_reason
     OR NEW.decided_at IS DISTINCT FROM OLD.decided_at THEN
    IF NOT (
      OLD.status IN ('MATCHED','DISCREPANCY') AND
      NEW.status IN ('APPROVED','RETURNED') AND
      NEW.decided_by_role_assignment_id IS NOT NULL AND
      NEW.decided_at IS NOT NULL AND
      length(btrim(NEW.decision_reason)) >= 10
    ) THEN
      RAISE EXCEPTION 'reconciliation decision metadata is immutable'
        USING ERRCODE = '55000';
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_reconciliation_decision_metadata
  BEFORE INSERT OR UPDATE ON reconciliations
  FOR EACH ROW EXECUTE FUNCTION payguard_guard_reconciliation_decision_metadata();
