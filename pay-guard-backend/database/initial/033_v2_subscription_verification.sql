-- Phase 7 subscription proof matching, Verify.ET outcomes and activation.

ALTER TABLE platform_settlement_accounts
  ADD COLUMN normalized_account_suffix varchar(32);

ALTER TABLE subscription_purchase_proofs
  ADD COLUMN parsed_account_suffix varchar(32),
  ADD COLUMN parsed_transaction_date date,
  ADD COLUMN parsed_transaction_time time;

ALTER TABLE subscription_payment_verifications
  ADD COLUMN idempotency_key varchar(160),
  ADD COLUMN payment_bank_id uuid REFERENCES supported_banks(id),
  ADD COLUMN provider_status varchar(32),
  ADD COLUMN provider_bank_identifier varchar(80),
  ADD COLUMN provider_transaction_reference varchar(180),
  ADD COLUMN provider_amount numeric(18,2),
  ADD COLUMN provider_receiver_suffix varchar(32),
  ADD COLUMN provider_transaction_at timestamptz,
  ADD COLUMN request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  ADD COLUMN last_requested_at timestamptz,
  ADD COLUMN last_responded_at timestamptz,
  ADD COLUMN duplicate_of_verification_id uuid REFERENCES subscription_payment_verifications(id),
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE subscription_payment_verifications verification
SET idempotency_key = 'subscription:verify:' || verification.order_id::text,
    payment_bank_id = purchase.payment_bank_id
FROM subscription_orders purchase
WHERE purchase.id = verification.order_id;

ALTER TABLE subscription_payment_verifications
  ALTER COLUMN idempotency_key SET NOT NULL,
  ALTER COLUMN payment_bank_id SET NOT NULL,
  ADD CONSTRAINT uq_subscription_verification_order UNIQUE (order_id),
  ADD CONSTRAINT uq_subscription_verification_key UNIQUE (idempotency_key),
  ADD CONSTRAINT ck_subscription_verification_duplicate CHECK (
    (verification_status = 'DUPLICATE') = (duplicate_of_verification_id IS NOT NULL)
  );

CREATE UNIQUE INDEX uq_verified_subscription_bank_reference
  ON subscription_payment_verifications(payment_bank_id, transaction_reference)
  WHERE verification_status = 'VERIFIED';

CREATE OR REPLACE FUNCTION payguard_guard_subscription_verification()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'subscription verification evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.payment_bank_id IS DISTINCT FROM OLD.payment_bank_id
     OR NEW.transaction_reference IS DISTINCT FROM OLD.transaction_reference
     OR NEW.amount IS DISTINCT FROM OLD.amount
     OR NEW.transaction_date IS DISTINCT FROM OLD.transaction_date
     OR NEW.transaction_time IS DISTINCT FROM OLD.transaction_time
     OR NEW.receipt_url_token IS DISTINCT FROM OLD.receipt_url_token
     OR NEW.credit_charged IS DISTINCT FROM OLD.credit_charged
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'subscription verification request evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.verification_status <> 'PENDING'
     AND NEW.verification_status IS DISTINCT FROM OLD.verification_status THEN
    RAISE EXCEPTION 'subscription verification outcome is final'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.verification_status IS DISTINCT FROM OLD.verification_status
     AND NEW.verification_status NOT IN ('VERIFIED','FAILED','DUPLICATE') THEN
    RAISE EXCEPTION 'invalid subscription verification transition'
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;

CREATE TRIGGER trg_subscription_verification_guard
  BEFORE UPDATE OR DELETE ON subscription_payment_verifications
  FOR EACH ROW EXECUTE FUNCTION payguard_guard_subscription_verification();
