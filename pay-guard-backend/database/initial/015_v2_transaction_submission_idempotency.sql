-- Client-generated idempotency key for safe transaction submission retries.

ALTER TABLE customer_transactions
  ADD COLUMN submission_key uuid;

CREATE UNIQUE INDEX uq_customer_transaction_submission_key
  ON customer_transactions(business_id, submitted_by_user_id, submission_key)
  WHERE submission_key IS NOT NULL;
