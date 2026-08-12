-- Phase 5 manual-deposit intake, idempotency and protected attachments.

ALTER TABLE manual_deposits
  ADD COLUMN idempotency_key uuid;

CREATE UNIQUE INDEX uq_manual_deposit_business_idempotency
  ON manual_deposits(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_manual_deposit_branch_actual_at
  ON manual_deposits(business_id, branch_id, actual_transaction_at DESC);

CREATE TABLE manual_deposit_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manual_deposit_id uuid NOT NULL UNIQUE REFERENCES manual_deposits(id),
  object_key varchar(600) NOT NULL UNIQUE,
  file_name varchar(255) NOT NULL,
  mime_type varchar(80) NOT NULL
    CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_manual_deposit_attachment_immutable
  BEFORE UPDATE OR DELETE ON manual_deposit_attachments
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
