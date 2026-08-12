-- Support bounded operational review counts without scanning the decision ledger.

CREATE INDEX ix_receipt_match_decisions_review_time
  ON receipt_match_decisions(decision, reason_code, created_at DESC);
