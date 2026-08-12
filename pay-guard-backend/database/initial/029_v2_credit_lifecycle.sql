-- Phase 7 subscription-to-branch linkage and immutable credit threshold alerts.

ALTER TABLE subscription_orders
  ADD COLUMN branch_id uuid REFERENCES branches(id);

ALTER TABLE business_subscriptions
  ADD COLUMN branch_id uuid REFERENCES branches(id);

CREATE TRIGGER trg_subscription_order_branch_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON subscription_orders
  FOR EACH ROW WHEN (NEW.branch_id IS NOT NULL)
  EXECUTE FUNCTION payguard_enforce_branch_tenant();

CREATE TRIGGER trg_business_subscription_branch_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON business_subscriptions
  FOR EACH ROW WHEN (NEW.branch_id IS NOT NULL)
  EXECUTE FUNCTION payguard_enforce_branch_tenant();

CREATE INDEX ix_subscription_orders_branch_time
  ON subscription_orders(branch_id, created_at DESC)
  WHERE branch_id IS NOT NULL;

CREATE TABLE credit_usage_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  credit_lot_id uuid NOT NULL REFERENCES credit_lots(id),
  threshold_percent smallint NOT NULL CHECK (threshold_percent IN (75,90,100)),
  used_credits bigint NOT NULL CHECK (used_credits >= 0),
  expired_credits bigint NOT NULL CHECK (expired_credits >= 0),
  allocated_credits bigint NOT NULL CHECK (allocated_credits > 0),
  trigger_event_id uuid NOT NULL REFERENCES credit_transactions(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (credit_lot_id, threshold_percent),
  CHECK (used_credits + expired_credits <= allocated_credits)
);

CREATE TRIGGER trg_credit_usage_alert_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON credit_usage_alerts
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_branch_tenant();

CREATE TRIGGER trg_credit_usage_alert_immutable
  BEFORE UPDATE OR DELETE ON credit_usage_alerts
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();

CREATE INDEX ix_credit_usage_alert_branch_time
  ON credit_usage_alerts(branch_id, created_at DESC);
