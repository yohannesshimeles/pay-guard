-- Phase 7 zero-credit subscription verification and deferred settlement integrity.

ALTER TABLE subscription_orders
  ALTER COLUMN branch_id SET NOT NULL,
  ADD CONSTRAINT uq_subscription_order_scope
    UNIQUE (id, business_id, branch_id);

ALTER TABLE business_subscriptions
  ALTER COLUMN branch_id SET NOT NULL,
  ADD CONSTRAINT uq_business_subscription_scope
    UNIQUE (id, business_id, branch_id);

ALTER TABLE credit_transactions
  ADD CONSTRAINT uq_credit_transaction_scope
    UNIQUE (id, business_id, branch_id);

ALTER TABLE deferred_credit_deductions
  ADD CONSTRAINT fk_deferred_credit_order_scope
    FOREIGN KEY (subscription_order_id, business_id, branch_id)
    REFERENCES subscription_orders(id, business_id, branch_id),
  ADD CONSTRAINT fk_deferred_credit_event_scope
    FOREIGN KEY (deferred_event_id, business_id, branch_id)
    REFERENCES credit_transactions(id, business_id, branch_id),
  ADD CONSTRAINT fk_settled_credit_event_scope
    FOREIGN KEY (settled_event_id, business_id, branch_id)
    REFERENCES credit_transactions(id, business_id, branch_id);

CREATE OR REPLACE FUNCTION payguard_guard_deferred_credit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deferred credit deduction is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.subscription_order_id IS DISTINCT FROM OLD.subscription_order_id
     OR NEW.deferred_event_id IS DISTINCT FROM OLD.deferred_event_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'deferred credit evidence is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF OLD.status <> 'PENDING' OR NEW.status NOT IN ('SETTLED','CANCELLED') THEN
    RAISE EXCEPTION 'invalid deferred credit transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_deferred_credit_guard
  BEFORE UPDATE OR DELETE ON deferred_credit_deductions
  FOR EACH ROW EXECUTE FUNCTION payguard_guard_deferred_credit_mutation();
