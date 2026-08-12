BEGIN;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS registration_number text,
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_status_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_status_check
  CHECK (status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'));
CREATE UNIQUE INDEX IF NOT EXISTS businesses_registration_number_unique
  ON businesses (lower(registration_number))
  WHERE registration_number IS NOT NULL;

CREATE TABLE business_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  previous_status text,
  next_status text NOT NULL,
  reason text,
  changed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_history_status_check
    CHECK (next_status IN ('PENDING', 'ACTIVE', 'SUSPENDED', 'REJECTED'))
);

ALTER TABLE branches
  ADD COLUMN IF NOT EXISTS code text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
CREATE UNIQUE INDEX IF NOT EXISTS branches_business_name_unique
  ON branches (business_id, lower(name));

CREATE TABLE branch_settings (
  branch_id uuid PRIMARY KEY REFERENCES branches(id),
  timezone text NOT NULL DEFAULT 'Africa/Addis_Ababa',
  currency_code text NOT NULL DEFAULT 'ETB',
  verification_time_tolerance_minutes integer NOT NULL DEFAULT 30
    CHECK (verification_time_tolerance_minutes BETWEEN 0 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS removed_at timestamptz,
  ADD COLUMN IF NOT EXISTS removal_reason text,
  ADD COLUMN IF NOT EXISTS removed_by uuid REFERENCES users(id);

CREATE TABLE banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO banks (code, name, enabled) VALUES
  ('CBE', 'Commercial Bank of Ethiopia', true),
  ('BOA', 'Bank of Abyssinia', true),
  ('TELEBIRR', 'Telebirr', true),
  ('MPESA', 'M-Pesa', true),
  ('CBE_BIRR', 'CBE Birr', true),
  ('DASHEN', 'Dashen Bank', true),
  ('AWASH', 'Awash Bank', true),
  ('SIINQEE', 'Siinqee Bank', true),
  ('KAAFI_EBIRR', 'Kaafi e-birr', true),
  ('ZEMEN', 'Zemen Bank', false)
ON CONFLICT (code) DO NOTHING;

CREATE TABLE settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  bank_id uuid NOT NULL REFERENCES banks(id),
  account_ciphertext text NOT NULL,
  account_iv text NOT NULL,
  account_auth_tag text NOT NULL,
  account_mask text NOT NULL,
  account_suffix text NOT NULL,
  label text,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT settlement_suffix_safe CHECK (account_suffix ~ '^[0-9]{4,8}$')
);
CREATE UNIQUE INDEX one_active_settlement_account_per_branch_bank
  ON settlement_accounts (branch_id, bank_id) WHERE active;

CREATE TABLE subscription_settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES banks(id),
  account_ciphertext text NOT NULL,
  account_iv text NOT NULL,
  account_auth_tag text NOT NULL,
  account_mask text NOT NULL,
  account_suffix text NOT NULL,
  accepted_plan_codes text[] NOT NULL DEFAULT
    ARRAY['STARTER', 'PROFESSIONAL', 'BUSINESS']::text[],
  active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  CONSTRAINT subscription_account_suffix_safe CHECK (account_suffix ~ '^[0-9]{4,8}$'),
  CONSTRAINT accepted_plan_codes_valid CHECK (
    accepted_plan_codes <@ ARRAY['STARTER', 'PROFESSIONAL', 'BUSINESS']::text[]
  )
);
CREATE UNIQUE INDEX one_active_subscription_account_per_bank
  ON subscription_settlement_accounts (bank_id) WHERE active;
CREATE UNIQUE INDEX one_default_subscription_account
  ON subscription_settlement_accounts (is_default) WHERE active AND is_default;

CREATE INDEX IF NOT EXISTS business_status_history_scope_time
  ON business_status_history (business_id, created_at DESC);
CREATE INDEX IF NOT EXISTS settlement_accounts_scope
  ON settlement_accounts (business_id, branch_id, active);

COMMIT;
