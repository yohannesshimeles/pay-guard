-- Phase 7 immutable invoice evidence, issued only by a verified subscription outcome.

CREATE TABLE subscription_invoices (
  id uuid PRIMARY KEY,
  invoice_number varchar(48) NOT NULL UNIQUE,
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid NOT NULL REFERENCES branches(id),
  order_id uuid NOT NULL UNIQUE REFERENCES subscription_orders(id),
  subscription_id uuid NOT NULL UNIQUE REFERENCES business_subscriptions(id),
  verification_id uuid NOT NULL UNIQUE REFERENCES subscription_payment_verifications(id),
  plan_id uuid NOT NULL REFERENCES subscription_plans(id),
  plan_name_snapshot varchar(100) NOT NULL,
  credits_snapshot bigint NOT NULL CHECK (credits_snapshot > 0),
  amount_etb numeric(18,2) NOT NULL CHECK (amount_etb > 0),
  currency char(3) NOT NULL DEFAULT 'ETB' CHECK (currency = 'ETB'),
  payment_reference varchar(180) NOT NULL,
  provider_request_id varchar(120) NOT NULL,
  issued_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, business_id, branch_id)
);

CREATE TRIGGER trg_subscription_invoice_tenant
  BEFORE INSERT OR UPDATE OF business_id, branch_id ON subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION payguard_enforce_branch_tenant();

CREATE TRIGGER trg_subscription_invoice_immutable
  BEFORE UPDATE OR DELETE ON subscription_invoices
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();

CREATE INDEX ix_subscription_invoice_branch_issued
  ON subscription_invoices(business_id, branch_id, issued_at DESC, id DESC);
