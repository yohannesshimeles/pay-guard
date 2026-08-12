-- Phase 5 ledger posting foundation. Existing entries remain valid and immutable.

ALTER TABLE ledger_entries
  DROP CONSTRAINT IF EXISTS ledger_entries_entry_type_check;

ALTER TABLE ledger_entries
  ADD CONSTRAINT ledger_entries_entry_type_check CHECK (entry_type IN (
    'OPENING_BALANCE','VERIFIED_DEPOSIT','MANUAL_DEPOSIT','WITHDRAWAL',
    'POSITIVE_CORRECTION','NEGATIVE_CORRECTION','REVERSAL'
  )),
  ADD COLUMN idempotency_key varchar(160),
  ADD COLUMN audit_log_id uuid REFERENCES audit_logs(id),
  ADD COLUMN reversal_of_entry_id uuid REFERENCES ledger_entries(id),
  ADD CONSTRAINT ck_ledger_reversal_link CHECK (
    (entry_type = 'REVERSAL' AND reversal_of_entry_id IS NOT NULL) OR
    (entry_type <> 'REVERSAL' AND reversal_of_entry_id IS NULL)
  ),
  ADD CONSTRAINT ck_ledger_not_self_reversal CHECK (
    reversal_of_entry_id IS NULL OR reversal_of_entry_id <> id
  );

CREATE UNIQUE INDEX uq_ledger_business_idempotency
  ON ledger_entries(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX uq_ledger_single_reversal
  ON ledger_entries(reversal_of_entry_id)
  WHERE reversal_of_entry_id IS NOT NULL;

CREATE INDEX ix_ledger_audit_log
  ON ledger_entries(audit_log_id)
  WHERE audit_log_id IS NOT NULL;
