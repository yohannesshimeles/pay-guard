-- Complete reconciliation snapshot provenance for existing and fresh databases.

ALTER TABLE reconciliations
  ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
