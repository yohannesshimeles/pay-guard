-- PayGuard PostgreSQL 16+ initial database baseline
-- Source: PayGuard Full Database Documentation, Version 2.0, 4 August 2026
-- Run only against an empty database. Do not combine with legacy migrations.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

CREATE OR REPLACE FUNCTION payguard_set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;

CREATE OR REPLACE FUNCTION payguard_prevent_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is immutable', TG_TABLE_NAME USING ERRCODE = '55000'; END $$;

-- Reference and platform identity
CREATE TABLE roles (
  code varchar(32) PRIMARY KEY,
  display_name varchar(80) NOT NULL,
  is_platform_role boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true
);

CREATE TABLE business_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(120) NOT NULL UNIQUE,
  is_other boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order smallint NOT NULL CHECK (sort_order > 0)
);

CREATE TABLE platform_admin (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(160) NOT NULL,
  phone_number varchar(32) NOT NULL UNIQUE,
  email citext NOT NULL UNIQUE,
  password_hash text NOT NULL,
  job_title varchar(120) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status = 'ACTIVE'),
  last_login_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name varchar(160) NOT NULL,
  phone_number varchar(32) NOT NULL UNIQUE,
  email citext,
  password_hash text NOT NULL,
  address text,
  gender varchar(10) CHECK (gender IN ('Male','Female')),
  global_status varchar(24) NOT NULL DEFAULT 'ACTIVE'
    CHECK (global_status IN ('ACTIVE','SUSPENDED','REMOVED')),
  phone_verified_at timestamptz,
  email_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_users_email ON users (email) WHERE email IS NOT NULL;

CREATE TABLE businesses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_code varchar(32) NOT NULL UNIQUE,
  legal_name varchar(220) NOT NULL,
  category_id uuid NOT NULL REFERENCES business_categories(id),
  custom_category varchar(160),
  tin varchar(64) NOT NULL UNIQUE,
  phone varchar(32) NOT NULL,
  email citext,
  address text NOT NULL,
  city varchar(120) NOT NULL,
  status varchar(28) NOT NULL DEFAULT 'REGISTRATION'
    CHECK (status IN ('REGISTRATION','ACTIVE','INACTIVE','SUSPENDED','CLOSED','ARCHIVED')),
  registration_at timestamptz NOT NULL DEFAULT now(),
  activation_at timestamptz,
  closed_at timestamptz,
  last_activity_at timestamptz,
  reopened_from_archived_business_id uuid REFERENCES businesses(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_business_custom_category CHECK (
    custom_category IS NULL OR length(btrim(custom_category)) >= 2
  )
);

CREATE TABLE business_user_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  status varchar(24) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','INACTIVE','REMOVED','SUSPENDED')),
  last_login_at timestamptz,
  last_active_at timestamptz,
  joined_at timestamptz,
  approved_by_membership_id uuid REFERENCES business_user_memberships(id),
  approved_at timestamptz,
  deactivation_type varchar(16) CHECK (deactivation_type IN ('SELF','ADMIN')),
  deactivated_by_membership_id uuid REFERENCES business_user_memberships(id),
  deactivated_at timestamptz,
  removed_by_membership_id uuid REFERENCES business_user_memberships(id),
  removed_at timestamptz,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, business_id),
  CONSTRAINT ck_membership_removal_reason CHECK (
    status <> 'REMOVED' OR (removed_at IS NOT NULL AND length(btrim(removal_reason)) >= 5)
  )
);

CREATE TABLE membership_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  role_code varchar(32) NOT NULL REFERENCES roles(code),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','INACTIVE','REMOVED')),
  approved_by_role_assignment_id uuid REFERENCES membership_role_assignments(id),
  approved_at timestamptz,
  assigned_at timestamptz,
  removed_at timestamptz,
  removed_by_role_assignment_id uuid REFERENCES membership_role_assignments(id),
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_active_membership_role
  ON membership_role_assignments(membership_id, role_code) WHERE status = 'ACTIVE';

CREATE TABLE branches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_code varchar(32) NOT NULL UNIQUE,
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_name varchar(180) NOT NULL,
  address text NOT NULL,
  city varchar(120) NOT NULL,
  sub_city varchar(120) NOT NULL,
  woreda varchar(80) NOT NULL,
  location_details text NOT NULL,
  settlement_mode varchar(24) NOT NULL DEFAULT 'MAIN_BUSINESS_ALL'
    CHECK (settlement_mode IN ('MAIN_BUSINESS_ALL','BRANCH_SPECIFIC')),
  status varchar(28) NOT NULL DEFAULT 'SETUP_REQUIRED'
    CHECK (status IN ('SETUP_REQUIRED','READY','ACTIVE','INACTIVE','SUSPENDED','CLOSED','ARCHIVED')),
  created_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  closed_at timestamptz,
  closure_reason text,
  last_activity_at timestamptz
);

CREATE TABLE user_work_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  membership_role_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  assignment_type varchar(20) NOT NULL CHECK (assignment_type IN ('MAIN_BUSINESS','BRANCH')),
  branch_id uuid REFERENCES branches(id),
  status varchar(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','ACTIVE','INACTIVE','REMOVED')),
  is_primary_context boolean NOT NULL DEFAULT false,
  approved_by_role_assignment_id uuid REFERENCES membership_role_assignments(id),
  approved_at timestamptz,
  assigned_at timestamptz,
  removed_at timestamptz,
  removal_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_work_assignment_scope CHECK (
    (assignment_type = 'MAIN_BUSINESS' AND branch_id IS NULL) OR
    (assignment_type = 'BRANCH' AND branch_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_active_work_assignment
  ON user_work_assignments(membership_role_id, assignment_type, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

CREATE TABLE business_registration_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  code_hash char(64) NOT NULL UNIQUE,
  display_code varchar(48) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','REPLACED')),
  generated_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz
);

CREATE TABLE branch_registration_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  display_code varchar(48) NOT NULL UNIQUE,
  code_hash char(64) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','REPLACED')),
  generated_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  replaced_at timestamptz
);

CREATE TABLE user_registration_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  requested_role varchar(32) NOT NULL REFERENCES roles(code),
  assignment_type varchar(20) NOT NULL CHECK (assignment_type IN ('MAIN_BUSINESS','BRANCH')),
  branch_id uuid REFERENCES branches(id),
  business_registration_code_id uuid NOT NULL REFERENCES business_registration_codes(id),
  branch_registration_code_id uuid REFERENCES branch_registration_codes(id),
  request_type varchar(24) NOT NULL CHECK (request_type IN ('JOIN_BUSINESS','ADD_ROLE','ADD_ASSIGNMENT')),
  status varchar(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED','CANCELLED')),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_role_assignment_id uuid REFERENCES membership_role_assignments(id),
  reviewed_at timestamptz,
  rejection_reason text,
  CONSTRAINT ck_registration_request_scope CHECK (
    (assignment_type = 'MAIN_BUSINESS' AND branch_id IS NULL AND branch_registration_code_id IS NULL) OR
    (assignment_type = 'BRANCH' AND branch_id IS NOT NULL AND branch_registration_code_id IS NOT NULL)
  ),
  CONSTRAINT ck_registration_rejection CHECK (status <> 'REJECTED' OR length(btrim(rejection_reason)) >= 3)
);

-- Banks and settlement accounts
CREATE TABLE supported_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  official_name varchar(180) NOT NULL UNIQUE,
  short_name varchar(60) NOT NULL UNIQUE,
  logo_file_id uuid,
  account_type varchar(32) NOT NULL CHECK (account_type IN ('BANK_ACCOUNT','WALLET')),
  account_number_pattern varchar(255),
  required_transaction_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  verification_method varchar(40) NOT NULL CHECK (verification_method IN ('REFERENCE','URL_TOKEN','TRANSACTION_NO')),
  account_suffix_length smallint CHECK (account_suffix_length > 0),
  phone_number_format varchar(80),
  verifyet_bank_identifier varchar(80) NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','DELETED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('MAIN_BUSINESS','BRANCH')),
  branch_id uuid REFERENCES branches(id),
  bank_id uuid NOT NULL REFERENCES supported_banks(id),
  account_name varchar(220) NOT NULL,
  account_number_encrypted bytea NOT NULL,
  account_number_hash char(64) NOT NULL UNIQUE,
  masked_account_number varchar(80) NOT NULL,
  normalized_account_suffix varchar(32),
  opening_balance numeric(18,2) NOT NULL CHECK (opening_balance >= 0),
  opening_balance_date date NOT NULL,
  calculated_balance numeric(18,2) NOT NULL,
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('DRAFT','ACTIVE','INACTIVE','REPLACED','REMOVED','SUSPENDED','ARCHIVED')),
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  replaces_account_id uuid REFERENCES settlement_accounts(id),
  created_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_activity_at timestamptz,
  CONSTRAINT ck_settlement_scope CHECK (
    (scope_type = 'MAIN_BUSINESS' AND branch_id IS NULL) OR
    (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_active_settlement_bank_scope
  ON settlement_accounts(business_id, scope_type, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid), bank_id)
  WHERE status = 'ACTIVE';

CREATE TABLE branch_settlement_configurations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL UNIQUE REFERENCES branches(id),
  mode varchar(24) NOT NULL CHECK (mode IN ('MAIN_BUSINESS_ALL','BRANCH_SPECIFIC')),
  configured_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  configured_at timestamptz NOT NULL DEFAULT now(),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE'))
);

CREATE TABLE platform_settlement_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_id uuid NOT NULL REFERENCES supported_banks(id),
  account_name varchar(220) NOT NULL,
  account_number_encrypted bytea NOT NULL,
  account_number_hash char(64) NOT NULL UNIQUE,
  masked_account_number varchar(80) NOT NULL,
  opening_balance numeric(18,2) NOT NULL CHECK (opening_balance >= 0),
  calculated_balance numeric(18,2) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','INACTIVE','REPLACED','REMOVED','SUSPENDED','ARCHIVED')),
  version_no integer NOT NULL DEFAULT 1 CHECK (version_no > 0),
  replaces_account_id uuid REFERENCES platform_settlement_accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_active_platform_bank_account
  ON platform_settlement_accounts(bank_id) WHERE status = 'ACTIVE';

-- Enforce the PDF's global fingerprint uniqueness across both account tables.
-- The advisory lock closes the concurrency gap between separate unique indexes.
CREATE OR REPLACE FUNCTION payguard_enforce_global_account_hash()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.account_number_hash, 0));
  IF TG_TABLE_NAME = 'settlement_accounts' AND EXISTS (
    SELECT 1 FROM platform_settlement_accounts
    WHERE account_number_hash = NEW.account_number_hash
  ) THEN
    RAISE EXCEPTION 'Settlement account fingerprint already exists'
      USING ERRCODE = '23505';
  ELSIF TG_TABLE_NAME = 'platform_settlement_accounts' AND EXISTS (
    SELECT 1 FROM settlement_accounts
    WHERE account_number_hash = NEW.account_number_hash
  ) THEN
    RAISE EXCEPTION 'Settlement account fingerprint already exists'
      USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_business_account_global_hash
  BEFORE INSERT OR UPDATE OF account_number_hash ON settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_global_account_hash();
CREATE TRIGGER trg_platform_account_global_hash
  BEFORE INSERT OR UPDATE OF account_number_hash ON platform_settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_global_account_hash();

CREATE OR REPLACE FUNCTION payguard_enforce_branch_tenant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.branch_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM branches b WHERE b.id = NEW.branch_id AND b.business_id = NEW.business_id
  ) THEN
    RAISE EXCEPTION 'Branch does not belong to the selected business'
      USING ERRCODE = '23503';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_settlement_branch_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON settlement_accounts
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_branch_tenant();

-- Subscriptions and credits
CREATE TABLE subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name varchar(100) NOT NULL,
  credits bigint NOT NULL CHECK (credits > 0),
  price_etb numeric(18,2) NOT NULL CHECK (price_etb > 0),
  duration_days smallint NOT NULL DEFAULT 30 CHECK (duration_days > 0),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  plan_name_snapshot varchar(100) NOT NULL,
  credits_snapshot bigint NOT NULL CHECK (credits_snapshot > 0),
  price_snapshot numeric(18,2) NOT NULL CHECK (price_snapshot > 0),
  duration_days_snapshot smallint NOT NULL CHECK (duration_days_snapshot > 0),
  purchasing_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  payment_bank_id uuid NOT NULL REFERENCES supported_banks(id),
  platform_account_id uuid NOT NULL REFERENCES platform_settlement_accounts(id),
  status varchar(32) NOT NULL DEFAULT 'ORDER_CREATED',
  created_at timestamptz NOT NULL DEFAULT now(),
  cancelled_at timestamptz
);

CREATE TABLE subscription_payment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES subscription_orders(id),
  transaction_reference varchar(180) NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL,
  transaction_time time NOT NULL,
  receipt_url_token text,
  verifyet_request_id varchar(120),
  verification_status varchar(24) NOT NULL CHECK (verification_status IN ('PENDING','VERIFIED','FAILED','DUPLICATE')),
  amount_match boolean NOT NULL DEFAULT false,
  duplicate_classification varchar(24) CHECK (duplicate_classification IN ('SAME_DAY','CROSS_DAY_FRAUD')),
  credit_charged boolean NOT NULL DEFAULT true,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE business_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  order_id uuid NOT NULL UNIQUE REFERENCES subscription_orders(id),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  credits_allocated bigint NOT NULL CHECK (credits_allocated > 0),
  credits_used bigint NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  credits_expired bigint NOT NULL DEFAULT 0 CHECK (credits_expired >= 0),
  price_paid numeric(18,2) NOT NULL CHECK (price_paid > 0),
  start_at timestamptz NOT NULL,
  expiry_at timestamptz NOT NULL,
  exhausted_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED','REPLACED','SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expiry_at > start_at)
);

CREATE TABLE business_credit_wallets (
  business_id uuid PRIMARY KEY REFERENCES businesses(id),
  purchased_credits bigint NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  used_credits bigint NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  active_subscription_id uuid REFERENCES business_subscriptions(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE credit_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  subscription_id uuid REFERENCES business_subscriptions(id),
  movement_type varchar(40) NOT NULL CHECK (movement_type IN (
    'ALLOCATION','VERIFICATION','RECHECK','DUPLICATE','SUBSCRIPTION_PAYMENT','EXPIRATION','ADMIN_CORRECTION')),
  credit_delta bigint NOT NULL,
  balance_before bigint NOT NULL CHECK (balance_before >= 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  related_record_type varchar(40),
  related_record_id uuid,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE platform_revenue_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid NOT NULL UNIQUE REFERENCES business_subscriptions(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  payment_bank_id uuid NOT NULL REFERENCES supported_banks(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  revenue_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Customer transactions and Verify.ET
CREATE TABLE customer_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  work_assignment_id uuid NOT NULL REFERENCES user_work_assignments(id),
  submitted_by_user_id uuid NOT NULL REFERENCES users(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  bank_id uuid NOT NULL REFERENCES supported_banks(id),
  transaction_reference varchar(180) NOT NULL,
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  transaction_date date NOT NULL,
  transaction_time time NOT NULL,
  receipt_url_token text,
  sender_name varchar(220),
  receiver_name varchar(220),
  masked_receiver_account varchar(100),
  submission_method varchar(20) NOT NULL CHECK (submission_method IN ('QR_SCAN','DOCUMENT_SCAN','MANUAL')),
  current_status varchar(28) NOT NULL DEFAULT 'PROCESSING'
    CHECK (current_status IN ('PROCESSING','VERIFIED','PENDING','FAILED','DUPLICATE','WAITING_CREDITS','PAUSED_BRANCH')),
  failure_reason text,
  verifyet_request_id varchar(120),
  finalized_at timestamptz,
  ledger_entry_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE transaction_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  storage_object_key text NOT NULL,
  file_name varchar(255) NOT NULL,
  mime_type varchar(100) NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','application/pdf')),
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  file_hash char(64) NOT NULL,
  submitted_by_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE verification_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  attempt_type varchar(24) NOT NULL CHECK (attempt_type IN ('INITIAL','REPEAT','RECHECK','SUBSCRIPTION')),
  attempt_number smallint NOT NULL CHECK (attempt_number > 0),
  provider_request_id varchar(120),
  provider_status varchar(24),
  result_status varchar(24) NOT NULL CHECK (result_status IN ('VERIFIED','PENDING','FAILED','DUPLICATE','QUEUED')),
  credit_transaction_id uuid REFERENCES credit_transactions(id),
  requested_at timestamptz,
  responded_at timestamptz,
  response_time_ms integer CHECK (response_time_ms >= 0),
  error_code varchar(80),
  provider_response_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, attempt_number)
);

CREATE TABLE pending_rechecks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  recheck_number smallint NOT NULL CHECK (recheck_number BETWEEN 1 AND 3),
  scheduled_at timestamptz NOT NULL,
  status varchar(28) NOT NULL DEFAULT 'SCHEDULED'
    CHECK (status IN ('SCHEDULED','WAITING_CREDITS','PAUSED_BRANCH','COMPLETED','CANCELLED')),
  pause_reason varchar(40),
  paused_at timestamptz,
  resumed_at timestamptz,
  verification_attempt_id uuid REFERENCES verification_attempts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (transaction_id, recheck_number)
);

CREATE TABLE transaction_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  from_status varchar(28),
  to_status varchar(28) NOT NULL,
  reason text,
  changed_by_user_id uuid REFERENCES users(id),
  verification_attempt_id uuid REFERENCES verification_attempts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE duplicate_transaction_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  original_transaction_id uuid REFERENCES customer_transactions(id),
  detected_by varchar(20) NOT NULL CHECK (detected_by IN ('PAYGUARD','VERIFYET')),
  credit_transaction_id uuid NOT NULL REFERENCES credit_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Ledger, cash operations and reconciliation
CREATE TABLE ledger_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  entry_type varchar(32) NOT NULL CHECK (entry_type IN (
    'OPENING_BALANCE','VERIFIED_DEPOSIT','MANUAL_DEPOSIT','WITHDRAWAL','POSITIVE_CORRECTION','NEGATIVE_CORRECTION')),
  direction varchar(8) NOT NULL CHECK (direction IN ('CREDIT','DEBIT')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  running_balance numeric(18,2) NOT NULL,
  actual_transaction_at timestamptz NOT NULL,
  source_record_type varchar(40) NOT NULL,
  source_record_id uuid NOT NULL,
  description text,
  created_by_user_id uuid REFERENCES users(id),
  work_assignment_id uuid REFERENCES user_work_assignments(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_record_type, source_record_id, entry_type)
);
ALTER TABLE customer_transactions
  ADD CONSTRAINT fk_customer_transaction_ledger FOREIGN KEY (ledger_entry_id) REFERENCES ledger_entries(id);

CREATE TABLE reconciliation_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  scope_type varchar(20) NOT NULL CHECK (scope_type IN ('MAIN_BUSINESS','BRANCH')),
  branch_id uuid REFERENCES branches(id),
  day_of_week smallint NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  closing_time time NOT NULL,
  timezone varchar(64) NOT NULL DEFAULT 'Africa/Addis_Ababa',
  reminder_enabled boolean NOT NULL DEFAULT true,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_reconciliation_schedule_scope CHECK (
    (scope_type = 'MAIN_BUSINESS' AND branch_id IS NULL) OR (scope_type = 'BRANCH' AND branch_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX uq_active_reconciliation_schedule
  ON reconciliation_schedules(business_id, scope_type, COALESCE(branch_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE status = 'ACTIVE';

CREATE TABLE reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  reconciliation_date date NOT NULL,
  closing_time time NOT NULL,
  opening_balance numeric(18,2) NOT NULL,
  verified_deposits_total numeric(18,2) NOT NULL,
  manual_deposits_total numeric(18,2) NOT NULL,
  withdrawals_total numeric(18,2) NOT NULL,
  positive_corrections_total numeric(18,2) NOT NULL,
  negative_corrections_total numeric(18,2) NOT NULL,
  calculated_balance numeric(18,2) NOT NULL,
  actual_bank_balance numeric(18,2) NOT NULL,
  difference numeric(18,2) NOT NULL,
  description text NOT NULL,
  difference_explanation text,
  status varchar(20) NOT NULL CHECK (status IN ('MATCHED','UNMATCHED','CORRECTED','SUPERSEDED','ARCHIVED')),
  sequence_no integer NOT NULL DEFAULT 1 CHECK (sequence_no > 0),
  submitted_by_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (settlement_account_id, reconciliation_date, sequence_no),
  CHECK (difference = actual_bank_balance - calculated_balance),
  CHECK (difference = 0 OR length(btrim(difference_explanation)) >= 3)
);

CREATE TABLE reconciliation_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid NOT NULL REFERENCES reconciliation_schedules(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  due_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','COMPLETED')),
  sent_at timestamptz,
  completed_by_reconciliation_id uuid REFERENCES reconciliations(id)
);

CREATE TABLE manual_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  description text NOT NULL,
  actual_transaction_at timestamptz NOT NULL,
  cashier_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES ledger_entries(id),
  status varchar(16) NOT NULL DEFAULT 'POSTED' CHECK (status = 'POSTED'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  recipient_name varchar(220) NOT NULL,
  recipient_bank_name varchar(180) NOT NULL,
  description text NOT NULL,
  actual_transaction_at timestamptz NOT NULL,
  recorded_by_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES ledger_entries(id),
  status varchar(16) NOT NULL DEFAULT 'POSTED' CHECK (status = 'POSTED'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE balance_corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  correction_type varchar(16) NOT NULL CHECK (correction_type IN ('POSITIVE','NEGATIVE')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  actual_transaction_at timestamptz NOT NULL,
  cashier_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  source_reconciliation_id uuid REFERENCES reconciliations(id),
  ledger_entry_id uuid NOT NULL UNIQUE REFERENCES ledger_entries(id),
  status varchar(16) NOT NULL DEFAULT 'POSTED' CHECK (status = 'POSTED'),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Notifications, announcements and reports
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id uuid NOT NULL REFERENCES users(id),
  business_id uuid REFERENCES businesses(id),
  title varchar(180) NOT NULL,
  message text NOT NULL,
  notification_type varchar(40) NOT NULL,
  is_read boolean NOT NULL DEFAULT false,
  read_at timestamptz,
  deleted_from_view_at timestamptz,
  visible_until timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  push_status varchar(20) NOT NULL DEFAULT 'PENDING',
  push_attempt_count smallint NOT NULL DEFAULT 0 CHECK (push_attempt_count BETWEEN 0 AND 3),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notification_delivery_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id uuid NOT NULL REFERENCES notifications(id),
  attempt_no smallint NOT NULL CHECK (attempt_no BETWEEN 1 AND 3),
  status varchar(16) NOT NULL CHECK (status IN ('DELIVERED','FAILED')),
  failure_reason text,
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, attempt_no)
);

CREATE TABLE announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title varchar(180) NOT NULL,
  message text NOT NULL,
  priority varchar(16) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('NORMAL','HIGH','URGENT')),
  start_at timestamptz NOT NULL,
  expiry_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','INACTIVE','DELETED')),
  created_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expiry_at > start_at)
);

CREATE TABLE announcement_role_targets (
  announcement_id uuid NOT NULL REFERENCES announcements(id),
  role_code varchar(32) NOT NULL REFERENCES roles(code),
  PRIMARY KEY (announcement_id, role_code)
);

CREATE TABLE report_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  work_assignment_id uuid NOT NULL REFERENCES user_work_assignments(id),
  report_type varchar(60) NOT NULL,
  frequency varchar(16) NOT NULL CHECK (frequency IN ('DAILY','WEEKLY','MONTHLY')),
  scheduled_day smallint,
  scheduled_time time NOT NULL,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by_role_assignment_id uuid NOT NULL REFERENCES membership_role_assignments(id),
  last_generated_at timestamptz,
  next_generation_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES businesses(id),
  report_type varchar(60) NOT NULL,
  requested_by_user_id uuid NOT NULL REFERENCES users(id),
  request_context_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  filter_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','PROCESSING','READY','FAILED','EXPIRED')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE TABLE report_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE REFERENCES report_generation_jobs(id),
  storage_object_key text NOT NULL,
  file_name varchar(255) NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  available_until timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE report_download_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_file_id uuid NOT NULL REFERENCES report_files(id),
  downloaded_by_user_id uuid NOT NULL REFERENCES users(id),
  downloaded_at timestamptz NOT NULL DEFAULT now()
);

-- Security, sessions and immutable audit
CREATE TABLE user_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  membership_id uuid REFERENCES business_user_memberships(id),
  membership_role_id uuid REFERENCES membership_role_assignments(id),
  work_assignment_id uuid REFERENCES user_work_assignments(id),
  session_status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (session_status IN ('ACTIVE','REVOKED','EXPIRED')),
  login_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text
);

CREATE OR REPLACE FUNCTION payguard_enforce_waiter_single_session()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected_role varchar(32);
BEGIN
  IF NEW.session_status <> 'ACTIVE' OR NEW.membership_role_id IS NULL THEN RETURN NEW; END IF;
  SELECT role_code INTO selected_role FROM membership_role_assignments WHERE id = NEW.membership_role_id;
  IF selected_role = 'WAITER' AND EXISTS (
    SELECT 1 FROM user_sessions s
    WHERE s.user_id = NEW.user_id AND s.session_status = 'ACTIVE' AND s.id <> NEW.id
  ) THEN
    RAISE EXCEPTION 'Waiter already has an active session' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_waiter_single_session
  BEFORE INSERT OR UPDATE OF session_status, membership_role_id ON user_sessions
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_waiter_single_session();

CREATE TABLE login_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  login_identifier_hash char(64) NOT NULL,
  success boolean NOT NULL,
  failure_reason varchar(80),
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE account_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  locked_at timestamptz NOT NULL DEFAULT now(),
  unlock_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','EXPIRED'))
);

CREATE TABLE otp_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  purpose varchar(40) NOT NULL,
  otp_hash char(64) NOT NULL,
  delivery_channel varchar(16) NOT NULL CHECK (delivery_channel IN ('PHONE','EMAIL')),
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '5 minutes'),
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE password_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE security_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  business_id uuid REFERENCES businesses(id),
  alert_type varchar(48) NOT NULL,
  severity varchar(16) NOT NULL,
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  membership_id uuid REFERENCES business_user_memberships(id),
  role_code varchar(32) REFERENCES roles(code),
  business_id uuid REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  action_type varchar(60) NOT NULL,
  record_type varchar(60) NOT NULL,
  record_id uuid,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  ip_address inet,
  session_id uuid REFERENCES user_sessions(id),
  result varchar(12) NOT NULL CHECK (result IN ('SUCCESS','FAILURE')),
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Closure, suspension and archive controls
CREATE TABLE business_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  closed_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  closure_reason text NOT NULL,
  password_confirmed boolean NOT NULL,
  otp_request_id uuid NOT NULL REFERENCES otp_requests(id),
  closed_at timestamptz NOT NULL DEFAULT now(),
  expired_credits bigint NOT NULL DEFAULT 0 CHECK (expired_credits >= 0),
  final_report_job_id uuid REFERENCES report_generation_jobs(id),
  reopened_at timestamptz,
  reopened_by_membership_id uuid REFERENCES business_user_memberships(id)
);

CREATE TABLE branch_closures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  branch_id uuid NOT NULL REFERENCES branches(id),
  closed_by_membership_id uuid NOT NULL REFERENCES business_user_memberships(id),
  closure_reason text NOT NULL,
  closed_at timestamptz NOT NULL DEFAULT now(),
  final_report_job_id uuid REFERENCES report_generation_jobs(id),
  reopened_at timestamptz,
  reopened_by_membership_id uuid REFERENCES business_user_memberships(id)
);

CREATE TABLE suspensions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  reason text NOT NULL,
  suspended_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CLEARED'))
);

CREATE TABLE closure_balance_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_closure_id uuid REFERENCES business_closures(id),
  branch_closure_id uuid REFERENCES branch_closures(id),
  settlement_account_id uuid NOT NULL REFERENCES settlement_accounts(id),
  calculated_balance numeric(18,2) NOT NULL,
  captured_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((business_closure_id IS NOT NULL)::int + (branch_closure_id IS NOT NULL)::int = 1)
);

CREATE TABLE archive_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_month date NOT NULL UNIQUE,
  status varchar(16) NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','COMPLETED','FAILED')),
  records_moved bigint NOT NULL DEFAULT 0 CHECK (records_moved >= 0),
  started_at timestamptz,
  completed_at timestamptz,
  failure_reason text
);

CREATE TABLE archive_restoration_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_table varchar(100) NOT NULL,
  archived_record_id uuid NOT NULL,
  restored_record_id uuid NOT NULL,
  restored_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  reason text NOT NULL,
  restored_at timestamptz NOT NULL DEFAULT now()
);

-- Platform risk, provider credits and settings
CREATE TABLE verifyet_provider_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  movement_type varchar(24) NOT NULL CHECK (movement_type IN ('PURCHASE','USE','CORRECTION')),
  credit_delta bigint NOT NULL,
  balance_before bigint NOT NULL CHECK (balance_before >= 0),
  balance_after bigint NOT NULL CHECK (balance_after >= 0),
  related_request_id varchar(120),
  created_by_admin_id uuid REFERENCES platform_admin(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE fraud_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  event_type varchar(48) NOT NULL CHECK (event_type IN ('CROSS_DAY_DUPLICATE','THREE_DUPLICATES','REPEATED_FAILURES')),
  related_order_id uuid REFERENCES subscription_orders(id),
  details_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLEARED')),
  trust_score_impact smallint NOT NULL DEFAULT 0,
  review_note text,
  cleared_by_admin_id uuid REFERENCES platform_admin(id),
  cleared_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE subscription_purchase_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  fraud_flag_id uuid NOT NULL REFERENCES fraud_flags(id),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','RECOVERY_ISSUED','UNLOCKED')),
  locked_at timestamptz NOT NULL DEFAULT now(),
  unlocked_at timestamptz
);

CREATE TABLE recovery_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  purchase_lock_id uuid NOT NULL REFERENCES subscription_purchase_locks(id),
  code_hash char(64) NOT NULL,
  generated_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  review_note text NOT NULL,
  generated_at timestamptz NOT NULL DEFAULT now(),
  delivered_to_user_id uuid NOT NULL REFERENCES users(id),
  delivery_status varchar(16) NOT NULL CHECK (delivery_status IN ('SENT','FAILED')),
  used_by_user_id uuid REFERENCES users(id),
  used_at timestamptz,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','USED','REVOKED'))
);

CREATE TABLE business_trust_scores (
  business_id uuid PRIMARY KEY REFERENCES businesses(id),
  score smallint NOT NULL CHECK (score BETWEEN 0 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE trust_score_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  previous_score smallint NOT NULL CHECK (previous_score BETWEEN 0 AND 100),
  new_score smallint NOT NULL CHECK (new_score BETWEEN 0 AND 100),
  trigger_type varchar(48) NOT NULL,
  trigger_record_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE global_settings (
  setting_key varchar(100) PRIMARY KEY,
  value_json jsonb NOT NULL,
  data_type varchar(24) NOT NULL,
  updated_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE global_setting_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key varchar(100) NOT NULL,
  previous_value jsonb,
  new_value jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  changed_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Critical indexes
CREATE INDEX ix_memberships_business_status ON business_user_memberships(business_id, status);
CREATE INDEX ix_memberships_user_status ON business_user_memberships(user_id, status);
CREATE INDEX ix_memberships_activity ON business_user_memberships(business_id, last_active_at DESC);
CREATE INDEX ix_roles_membership_status ON membership_role_assignments(membership_id, status);
CREATE INDEX ix_work_assignment_scope ON user_work_assignments(business_id, branch_id, status);
CREATE INDEX ix_transactions_business_date ON customer_transactions(business_id, transaction_date DESC);
CREATE INDEX ix_transactions_bank_reference ON customer_transactions(bank_id, transaction_reference);
CREATE INDEX ix_transactions_status ON customer_transactions(business_id, current_status, created_at);
CREATE INDEX ix_pending_rechecks_due ON pending_rechecks(status, scheduled_at);
CREATE INDEX ix_settlement_scope ON settlement_accounts(business_id, scope_type, branch_id, status);
CREATE INDEX ix_ledger_account_time ON ledger_entries(settlement_account_id, actual_transaction_at, id);
CREATE INDEX ix_ledger_business_scope_time ON ledger_entries(business_id, branch_id, actual_transaction_at);
CREATE INDEX ix_credit_transactions_business_time ON credit_transactions(business_id, created_at DESC);
CREATE INDEX ix_notifications_visible ON notifications(recipient_user_id, visible_until, is_read);
CREATE INDEX ix_audit_business_time ON audit_logs(business_id, created_at DESC);
CREATE INDEX ix_audit_user_time ON audit_logs(user_id, created_at DESC);
CREATE INDEX ix_audit_action_time ON audit_logs(action_type, created_at);
CREATE INDEX ix_report_jobs_status ON report_generation_jobs(status, created_at);
CREATE INDEX ix_report_jobs_business ON report_generation_jobs(business_id, created_at DESC);
CREATE INDEX ix_fraud_business_status ON fraud_flags(business_id, status, created_at DESC);

-- Archived monthly tables are intentionally generated by the archive job from the
-- corresponding active table schema; the PDF names them as archived_* rather than
-- defining one concrete wildcard table.

-- Updated-at triggers
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION payguard_set_updated_at();
CREATE TRIGGER trg_memberships_updated BEFORE UPDATE ON business_user_memberships FOR EACH ROW EXECUTE FUNCTION payguard_set_updated_at();
CREATE TRIGGER trg_banks_updated BEFORE UPDATE ON supported_banks FOR EACH ROW EXECUTE FUNCTION payguard_set_updated_at();
CREATE TRIGGER trg_plans_updated BEFORE UPDATE ON subscription_plans FOR EACH ROW EXECUTE FUNCTION payguard_set_updated_at();
CREATE TRIGGER trg_reconciliation_schedules_updated BEFORE UPDATE ON reconciliation_schedules FOR EACH ROW EXECUTE FUNCTION payguard_set_updated_at();
CREATE TRIGGER trg_announcements_updated BEFORE UPDATE ON announcements FOR EACH ROW EXECUTE FUNCTION payguard_set_updated_at();

-- Immutability guards for finalized financial and historical records
CREATE TRIGGER trg_ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_manual_deposit_immutable BEFORE UPDATE OR DELETE ON manual_deposits FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_withdrawal_immutable BEFORE UPDATE OR DELETE ON withdrawals FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_correction_immutable BEFORE UPDATE OR DELETE ON balance_corrections FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_reconciliation_immutable BEFORE UPDATE OR DELETE ON reconciliations FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_credit_immutable BEFORE UPDATE OR DELETE ON credit_transactions FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_status_history_immutable BEFORE UPDATE OR DELETE ON transaction_status_history FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
CREATE TRIGGER trg_audit_immutable BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();

-- Reference seeds
INSERT INTO roles(code, display_name, is_platform_role) VALUES
  ('PLATFORM_SUPER_ADMIN','Platform Super Admin',true),
  ('PRIMARY_OWNER','Primary Owner',false),
  ('ADDITIONAL_OWNER','Additional Owner',false),
  ('MANAGER','Manager',false),
  ('CASHIER','Cashier',false),
  ('WAITER','Waiter',false);

INSERT INTO business_categories(name, is_other, sort_order) VALUES
  ('Coffee House',false,1),('Food and Beverage',false,2),('Textile and Garment',false,3),
  ('Leather and Footwear',false,4),('Furniture',false,5),('Chemicals',false,6),
  ('Pharmaceuticals',false,7),('Metal and Steel',false,8),('Plastic Products',false,9),
  ('Supermarkets',false,10),('Grocery Stores',false,11),('Electronics',false,12),
  ('Clothing Stores',false,13),('Automotive Parts',false,14),('Hotels',false,15),
  ('Restaurants',false,16),('Cafe',false,17),('Resorts',false,18),('Taxi Services',false,19),
  ('Hospitals',false,20),('Clinics',false,21),('Diagnostic Laboratories',false,22),
  ('Medical Equipment Suppliers',false,23),('Schools',false,24),('Colleges',false,25),
  ('Marketing Agencies',false,26),('Photography',false,27),('Vehicle Maintenance',false,28),
  ('Car Rental',false,29),('Cinemas',false,30),('Gaming Center',false,31),('Other',true,32);

INSERT INTO subscription_plans(name, credits, price_etb, duration_days) VALUES
  ('Starter',10000,8000.00,30),
  ('Professional',20000,13000.00,30),
  ('Business',30000,18000.00,30);

INSERT INTO supported_banks(
  official_name, short_name, account_type, verification_method,
  account_suffix_length, phone_number_format, verifyet_bank_identifier
) VALUES
  ('Commercial Bank of Ethiopia','CBE','BANK_ACCOUNT','REFERENCE',8,NULL,'CBE'),
  ('Telebirr','Telebirr','WALLET','TRANSACTION_NO',NULL,'251XXXXXXXXX','TELEBIRR'),
  ('Dashen Bank','Dashen','BANK_ACCOUNT','REFERENCE',NULL,NULL,'DASHEN'),
  ('Bank of Abyssinia','BOA','BANK_ACCOUNT','REFERENCE',5,NULL,'BOA'),
  ('CBE Birr','CBE Birr','WALLET','REFERENCE',NULL,'251XXXXXXXXX','CBE_BIRR'),
  ('Awash Bank','Awash','BANK_ACCOUNT','URL_TOKEN',NULL,NULL,'AWASH'),
  ('M-PESA','M-PESA','WALLET','TRANSACTION_NO',NULL,'251XXXXXXXXX','MPESA'),
  ('Siinqee Bank','Siinqee','BANK_ACCOUNT','URL_TOKEN',NULL,NULL,'SIINQEE'),
  ('Kaafi Ebirr','Kaafi Ebirr','WALLET','URL_TOKEN',NULL,'251XXXXXXXXX','KAAFI_EBIRR');

COMMIT;
