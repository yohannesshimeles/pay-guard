-- Canonical Phase 7 credit events are branch-owned. Replace the legacy check that
-- referenced pre-Phase-7 movement names.

ALTER TABLE credit_transactions
  DROP CONSTRAINT IF EXISTS ck_credit_transaction_branch_scope,
  ADD CONSTRAINT ck_credit_transaction_branch_scope CHECK (
    branch_id IS NOT NULL
  ),
  ADD CONSTRAINT fk_credit_transaction_lot_scope
    FOREIGN KEY (credit_lot_id, business_id, branch_id)
    REFERENCES credit_lots(id, business_id, branch_id);
