-- Preserve the zero-credit deferred verification path while proof intake is
-- rolled out. Both routes converge on the same VERIFICATION_PENDING state.
CREATE OR REPLACE FUNCTION payguard_guard_subscription_order_snapshot()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.business_id IS DISTINCT FROM OLD.business_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id
     OR NEW.plan_id IS DISTINCT FROM OLD.plan_id
     OR NEW.plan_name_snapshot IS DISTINCT FROM OLD.plan_name_snapshot
     OR NEW.credits_snapshot IS DISTINCT FROM OLD.credits_snapshot
     OR NEW.price_snapshot IS DISTINCT FROM OLD.price_snapshot
     OR NEW.duration_days_snapshot IS DISTINCT FROM OLD.duration_days_snapshot
     OR NEW.purchasing_membership_id IS DISTINCT FROM OLD.purchasing_membership_id
     OR NEW.payment_bank_id IS DISTINCT FROM OLD.payment_bank_id
     OR NEW.platform_account_id IS DISTINCT FROM OLD.platform_account_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'subscription order purchase snapshot is immutable'
      USING ERRCODE = '55000';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
    (OLD.status = 'ORDER_CREATED' AND NEW.status IN ('PROOF_RECEIVED','VERIFICATION_PENDING','CANCELLED')) OR
    (OLD.status = 'PROOF_RECEIVED' AND NEW.status IN ('VERIFICATION_PENDING','FAILED')) OR
    (OLD.status = 'VERIFICATION_PENDING' AND NEW.status IN ('VERIFIED','FAILED','DUPLICATE'))
  ) THEN
    RAISE EXCEPTION 'invalid subscription order transition % -> %', OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
