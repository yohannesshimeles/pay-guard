-- Persist the internal authority responsible for every verification state change.

ALTER TABLE transaction_status_history
  ADD COLUMN transition_source varchar(20) NOT NULL DEFAULT 'SYSTEM'
    CHECK (transition_source IN ('SYSTEM','VERIFYET','CREDIT_POLICY'));

CREATE INDEX ix_transaction_status_history_source_time
  ON transaction_status_history(transition_source, created_at DESC);
