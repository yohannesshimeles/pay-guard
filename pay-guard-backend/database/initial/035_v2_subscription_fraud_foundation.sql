-- Phase 8 immutable subscription-proof reuse evidence and purchase locking.

CREATE TABLE subscription_fraud_rules (
  rule_key varchar(80) PRIMARY KEY,
  qualifying_attempt_threshold smallint NOT NULL CHECK (qualifying_attempt_threshold > 0),
  window_days smallint NOT NULL CHECK (window_days > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO subscription_fraud_rules (
  rule_key, qualifying_attempt_threshold, window_days
) VALUES ('SUBSCRIPTION_CROSS_DAY_REUSE', 3, 30);

CREATE TABLE subscription_fraud_attempts (
  id uuid PRIMARY KEY,
  fraud_flag_id uuid NOT NULL UNIQUE REFERENCES fraud_flags(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  order_id uuid NOT NULL UNIQUE REFERENCES subscription_orders(id),
  verification_id uuid NOT NULL UNIQUE REFERENCES subscription_payment_verifications(id),
  original_verification_id uuid NOT NULL REFERENCES subscription_payment_verifications(id),
  payment_bank_id uuid NOT NULL REFERENCES supported_banks(id),
  transaction_reference varchar(180) NOT NULL,
  original_transaction_date date NOT NULL,
  attempted_transaction_date date NOT NULL,
  classification varchar(24) NOT NULL CHECK (classification = 'CROSS_DAY_FRAUD'),
  qualifying_attempt_number integer NOT NULL CHECK (qualifying_attempt_number > 0),
  rule_window_days smallint NOT NULL CHECK (rule_window_days > 0),
  detected_at timestamptz NOT NULL DEFAULT now(),
  CHECK (attempted_transaction_date <> original_transaction_date),
  UNIQUE (id, business_id, branch_id)
);

CREATE INDEX ix_subscription_fraud_attempt_window
  ON subscription_fraud_attempts(business_id, detected_at DESC, id DESC);

CREATE UNIQUE INDEX uq_active_subscription_purchase_lock
  ON subscription_purchase_locks(business_id)
  WHERE status IN ('ACTIVE', 'RECOVERY_ISSUED');

CREATE OR REPLACE FUNCTION payguard_prevent_subscription_fraud_attempt_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'subscription fraud attempt evidence is immutable'
    USING ERRCODE = '55000';
END $$;

CREATE TRIGGER trg_subscription_fraud_attempt_immutable
  BEFORE UPDATE OR DELETE ON subscription_fraud_attempts
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_subscription_fraud_attempt_mutation();

