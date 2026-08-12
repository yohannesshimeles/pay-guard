-- Phase 7 branch credit lots, canonical credit events and deferred obligations.

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS credit_transactions_movement_type_check;

UPDATE credit_transactions
SET movement_type = CASE movement_type
  WHEN 'ALLOCATION' THEN 'SUBSCRIPTION_CREDIT_GRANT'
  WHEN 'VERIFICATION' THEN 'VERIFICATION_DEDUCTION'
  WHEN 'RECHECK' THEN 'VERIFICATION_DEDUCTION'
  WHEN 'DUPLICATE' THEN 'VERIFICATION_DEDUCTION'
  WHEN 'SUBSCRIPTION_PAYMENT' THEN 'SUBSCRIPTION_VERIFICATION_DEFERRED'
  WHEN 'EXPIRATION' THEN 'CREDIT_EXPIRY'
  WHEN 'ADMIN_CORRECTION' THEN 'ADMIN_ADJUSTMENT'
  ELSE movement_type
END;

ALTER TABLE credit_transactions
  ADD COLUMN credit_lot_id uuid,
  ADD COLUMN created_by_user_id uuid REFERENCES users(id),
  ADD COLUMN audit_log_id uuid REFERENCES audit_logs(id),
  ADD CONSTRAINT credit_transactions_movement_type_check CHECK (
    movement_type IN (
      'SUBSCRIPTION_CREDIT_GRANT',
      'VERIFICATION_DEDUCTION',
      'SUBSCRIPTION_VERIFICATION_DEFERRED',
      'DEFERRED_DEDUCTION_SETTLED',
      'CREDIT_EXPIRY',
      'ADMIN_ADJUSTMENT'
    )
  );

CREATE TABLE credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  subscription_id uuid REFERENCES business_subscriptions(id),
  grant_credit_transaction_id uuid REFERENCES credit_transactions(id),
  source_event_key varchar(180) NOT NULL UNIQUE,
  allocated_credits bigint NOT NULL CHECK (allocated_credits > 0),
  used_credits bigint NOT NULL DEFAULT 0 CHECK (used_credits >= 0),
  expired_credits bigint NOT NULL DEFAULT 0 CHECK (expired_credits >= 0),
  remaining_credits bigint GENERATED ALWAYS AS (
    allocated_credits - used_credits - expired_credits
  ) STORED,
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (status IN ('ACTIVE','EXHAUSTED','EXPIRED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (used_credits + expired_credits <= allocated_credits),
  CHECK (expires_at > starts_at),
  UNIQUE (id, business_id, branch_id)
);

ALTER TABLE credit_transactions
  ADD CONSTRAINT fk_credit_transaction_lot
    FOREIGN KEY (credit_lot_id) REFERENCES credit_lots(id);

CREATE TRIGGER trg_credit_lot_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON credit_lots
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_branch_tenant();

CREATE INDEX ix_credit_lots_fifo
  ON credit_lots(branch_id, expires_at, created_at, id)
  WHERE status = 'ACTIVE';

INSERT INTO credit_lots (
  business_id, branch_id, subscription_id, source_event_key,
  allocated_credits, used_credits, expired_credits, starts_at, expires_at, status
)
SELECT wallet.business_id, wallet.branch_id, wallet.active_subscription_id,
       'migration:wallet:' || wallet.branch_id::text,
       wallet.purchased_credits, wallet.used_credits, wallet.expired_credits,
       now(), now() + interval '1 month',
       CASE
         WHEN wallet.available_credits = 0 THEN 'EXHAUSTED'
         ELSE 'ACTIVE'
       END
FROM branch_credit_wallets wallet
WHERE wallet.purchased_credits > 0;

CREATE TABLE deferred_credit_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  subscription_order_id uuid NOT NULL REFERENCES subscription_orders(id),
  deferred_event_id uuid NOT NULL REFERENCES credit_transactions(id),
  settled_event_id uuid REFERENCES credit_transactions(id),
  status varchar(16) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SETTLED','CANCELLED')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  settled_at timestamptz,
  cancelled_at timestamptz,
  CHECK (
    (status = 'PENDING' AND settled_event_id IS NULL AND settled_at IS NULL
      AND cancelled_at IS NULL) OR
    (status = 'SETTLED' AND settled_event_id IS NOT NULL AND settled_at IS NOT NULL
      AND cancelled_at IS NULL) OR
    (status = 'CANCELLED' AND settled_event_id IS NULL AND settled_at IS NULL
      AND cancelled_at IS NOT NULL)
  )
);

CREATE TRIGGER trg_deferred_credit_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON deferred_credit_deductions
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_branch_tenant();

CREATE UNIQUE INDEX uq_pending_deferred_credit_per_order
  ON deferred_credit_deductions(subscription_order_id)
  WHERE status = 'PENDING';

CREATE INDEX ix_deferred_credit_branch_status
  ON deferred_credit_deductions(branch_id, status, created_at);
