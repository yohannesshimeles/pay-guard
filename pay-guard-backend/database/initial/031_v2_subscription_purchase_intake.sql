-- Phase 7 owner subscription purchase intake and immutable payment proof.

ALTER TABLE subscription_orders
  ADD COLUMN idempotency_key uuid DEFAULT gen_random_uuid(),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE subscription_orders SET idempotency_key = id WHERE idempotency_key IS NULL;

ALTER TABLE subscription_orders
  ALTER COLUMN idempotency_key SET NOT NULL,
  ADD CONSTRAINT uq_subscription_order_idempotency
    UNIQUE (business_id, idempotency_key),
  ADD CONSTRAINT ck_subscription_order_status
    CHECK (status IN (
      'ORDER_CREATED','PROOF_RECEIVED','VERIFICATION_PENDING','VERIFIED',
      'FAILED','DUPLICATE','CANCELLED'
    ));

CREATE TABLE subscription_purchase_proofs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES subscription_orders(id),
  object_key text NOT NULL UNIQUE,
  file_name varchar(255) NOT NULL,
  mime_type varchar(40) NOT NULL
    CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  sha256 char(64) NOT NULL,
  extraction_state varchar(32) NOT NULL
    CHECK (extraction_state IN ('SINGLE_QR','NO_QR','MULTIPLE_QR','UNSUPPORTED_PROOF')),
  candidate_count smallint NOT NULL CHECK (candidate_count >= 0),
  qr_payload_sha256 char(64),
  parsed_bank_code varchar(32),
  parsed_reference varchar(180),
  parsed_amount_etb numeric(18,2),
  uploaded_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((candidate_count = 1) = (extraction_state = 'SINGLE_QR')),
  CHECK (parsed_amount_etb IS NULL OR parsed_amount_etb > 0)
);

CREATE INDEX ix_subscription_orders_branch_created
  ON subscription_orders(business_id, branch_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION payguard_guard_subscription_order_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_name_snapshot IS DISTINCT FROM OLD.plan_name_snapshot
     OR NEW.credits_snapshot IS DISTINCT FROM OLD.credits_snapshot
     OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
     OR NEW.duration_days_snapshot IS DISTINCT FROM OLD.duration_days_snapshot
     OR NEW.purchasing_membership_id IS DISTINCT FROM OLD.purchasing_membership_id
     OR NEW.payment_bank_id IS DISTINCT FROM OLD.payment_bank_id
     OR NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'subscription order purchase snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'ORDER_CREATED' AND NEW.status IN ('PROOF_RECEIVED','CANCELLED')) OR
    (OLD.status = 'PROOF_RECEIVED' AND NEW.status IN ('VERIFICATION_PENDING','FAILED')) OR
    (OLD.status = 'VERIFICATION_PENDING' AND NEW.status IN ('VERIFIED','FAILED','DUPLICATE'))
  ) THEN
    RAISE EXCEPTION 'invalid subscription order transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_subscription_order_snapshot_guard
  BEFORE UPDATE ON subscription_orders
  FOR EACH ROW EXECUTE FUNCTION payguard_guard_subscription_order_snapshot();

CREATE TRIGGER trg_subscription_purchase_proof_immutable
  BEFORE UPDATE OR DELETE ON subscription_purchase_proofs
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
