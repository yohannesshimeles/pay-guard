-- Give reconciliation history a deterministic, immutable workflow order.

DROP TRIGGER IF EXISTS trg_reconciliation_history_immutable
  ON reconciliation_status_history;

ALTER TABLE reconciliation_status_history
  ADD COLUMN transition_no integer;

WITH numbered AS (
  SELECT id, row_number() OVER (
    PARTITION BY reconciliation_id ORDER BY created_at, id
  )::integer AS transition_no
  FROM reconciliation_status_history
)
UPDATE reconciliation_status_history history
SET transition_no = numbered.transition_no
FROM numbered WHERE numbered.id = history.id;

ALTER TABLE reconciliation_status_history
  ALTER COLUMN transition_no SET NOT NULL,
  ADD CONSTRAINT uq_reconciliation_history_transition
    UNIQUE (reconciliation_id, transition_no),
  ADD CONSTRAINT ck_reconciliation_history_transition_positive
    CHECK (transition_no > 0);

CREATE TRIGGER trg_reconciliation_history_immutable
  BEFORE UPDATE OR DELETE ON reconciliation_status_history
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
