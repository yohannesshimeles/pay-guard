-- Support tenant/branch transaction history and Waiter own-history queries.

CREATE INDEX ix_customer_transactions_business_branch_created
  ON customer_transactions(business_id, branch_id, created_at DESC, id DESC);

CREATE INDEX ix_customer_transactions_submitter_created
  ON customer_transactions(submitted_by_user_id, created_at DESC, id DESC);
