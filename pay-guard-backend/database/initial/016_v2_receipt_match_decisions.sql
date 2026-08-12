-- Immutable, sanitized explanation of the receipt-to-transaction matching gate.

CREATE TABLE receipt_match_decisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL UNIQUE REFERENCES transaction_receipts(id),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  decision varchar(24) NOT NULL
    CHECK (decision IN ('MATCHED','REVIEW_REQUIRED')),
  reason_code varchar(40)
    CHECK (reason_code IN (
      'NO_QR','MULTIPLE_QR','UNSUPPORTED_PROOF','INCOMPLETE_QR',
      'UNSUPPORTED_BANK','BANK_MISMATCH','REFERENCE_MISMATCH',
      'AMOUNT_MISMATCH','DATE_MISMATCH','TIME_MISMATCH','ACCOUNT_MISMATCH'
    )),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_receipt_match_decision_reason CHECK (
    (decision = 'MATCHED' AND reason_code IS NULL) OR
    (decision = 'REVIEW_REQUIRED' AND reason_code IS NOT NULL)
  )
);

CREATE INDEX ix_receipt_match_decisions_transaction_time
  ON receipt_match_decisions(transaction_id, created_at DESC);

CREATE TRIGGER trg_receipt_match_decision_immutable
  BEFORE UPDATE OR DELETE ON receipt_match_decisions
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
