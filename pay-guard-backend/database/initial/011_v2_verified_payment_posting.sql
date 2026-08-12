-- Matching configuration, unique confirmations and duplicate-attempt identity.

CREATE TABLE branch_verification_settings (
  branch_id uuid PRIMARY KEY REFERENCES branches(id),
  timezone varchar(64) NOT NULL,
  time_tolerance_minutes smallint NOT NULL
    CHECK (time_tolerance_minutes BETWEEN 0 AND 1440),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_confirmations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL UNIQUE REFERENCES customer_transactions(id),
  verification_attempt_id uuid NOT NULL UNIQUE REFERENCES verification_attempts(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  bank_id uuid NOT NULL REFERENCES supported_banks(id),
  transaction_reference varchar(180) NOT NULL,
  receiver_account_suffix varchar(32) NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  provider_transaction_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_id, transaction_reference, receiver_account_suffix)
);

ALTER TABLE duplicate_transaction_attempts
  ADD COLUMN verification_attempt_id uuid REFERENCES verification_attempts(id);

CREATE UNIQUE INDEX uq_duplicate_transaction_verification_attempt
  ON duplicate_transaction_attempts(verification_attempt_id)
  WHERE verification_attempt_id IS NOT NULL;
