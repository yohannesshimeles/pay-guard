-- Phase 5 Cashier withdrawal intake and exact replay protection.

ALTER TABLE withdrawals
  ADD COLUMN idempotency_key uuid;

CREATE UNIQUE INDEX uq_withdrawal_business_idempotency
  ON withdrawals(business_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_withdrawal_branch_actual_at
  ON withdrawals(business_id, branch_id, actual_transaction_at DESC);
