-- Branch-specific credit source of truth required by ordinary verification.

CREATE TABLE branch_credit_wallets (
  branch_id uuid PRIMARY KEY REFERENCES branches(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  purchased_credits bigint NOT NULL DEFAULT 0 CHECK (purchased_credits >= 0),
  used_credits bigint NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  expired_credits bigint NOT NULL DEFAULT 0 CHECK (expired_credits >= 0),
  available_credits bigint NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  active_subscription_id uuid REFERENCES business_subscriptions(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (branch_id, business_id),
  CHECK (
    purchased_credits = used_credits + expired_credits + available_credits
  )
);

CREATE TRIGGER trg_branch_credit_wallet_tenant
  BEFORE INSERT OR UPDATE OF branch_id, business_id ON branch_credit_wallets
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_branch_tenant();

ALTER TABLE credit_transactions
  ADD COLUMN branch_id uuid REFERENCES branches(id),
  ADD COLUMN credit_event_key varchar(160) UNIQUE,
  ADD CONSTRAINT ck_credit_transaction_branch_scope CHECK (
    movement_type NOT IN ('VERIFICATION','RECHECK','DUPLICATE')
    OR branch_id IS NOT NULL
  );

CREATE UNIQUE INDEX uq_credit_transaction_related_movement
  ON credit_transactions(related_record_type, related_record_id, movement_type)
  WHERE related_record_type IS NOT NULL AND related_record_id IS NOT NULL;

CREATE INDEX ix_credit_transactions_branch_time
  ON credit_transactions(branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;
