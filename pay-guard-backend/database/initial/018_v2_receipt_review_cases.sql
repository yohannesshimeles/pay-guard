-- Operational review workflow. It has no authority over financial transaction state.

CREATE TABLE receipt_review_cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_match_decision_id uuid NOT NULL UNIQUE
    REFERENCES receipt_match_decisions(id),
  transaction_id uuid NOT NULL REFERENCES customer_transactions(id),
  status varchar(20) NOT NULL DEFAULT 'OPEN'
    CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  acknowledged_at timestamptz,
  acknowledged_by_user_id uuid REFERENCES users(id),
  acknowledgement_note varchar(500),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users(id),
  resolution_code varchar(32)
    CHECK (resolution_code IN (
      'EVIDENCE_REPLACED','FALSE_POSITIVE','INVALID_RECEIPT',
      'DUPLICATE_RECEIPT','OTHER'
    )),
  resolution_note varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_receipt_review_case_lifecycle CHECK (
    (status = 'OPEN' AND acknowledged_at IS NULL
      AND acknowledged_by_user_id IS NULL AND resolved_at IS NULL
      AND resolved_by_user_id IS NULL AND resolution_code IS NULL) OR
    (status = 'ACKNOWLEDGED' AND acknowledged_at IS NOT NULL
      AND acknowledged_by_user_id IS NOT NULL AND resolved_at IS NULL
      AND resolved_by_user_id IS NULL AND resolution_code IS NULL) OR
    (status = 'RESOLVED' AND acknowledged_at IS NOT NULL
      AND acknowledged_by_user_id IS NOT NULL AND resolved_at IS NOT NULL
      AND resolved_by_user_id IS NOT NULL AND resolution_code IS NOT NULL)
  )
);

CREATE TABLE receipt_review_case_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES receipt_review_cases(id),
  from_status varchar(20)
    CHECK (from_status IN ('OPEN','ACKNOWLEDGED')),
  to_status varchar(20) NOT NULL
    CHECK (to_status IN ('OPEN','ACKNOWLEDGED','RESOLVED')),
  action_by_user_id uuid REFERENCES users(id),
  note varchar(500),
  resolution_code varchar(32)
    CHECK (resolution_code IN (
      'EVIDENCE_REPLACED','FALSE_POSITIVE','INVALID_RECEIPT',
      'DUPLICATE_RECEIPT','OTHER'
    )),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, to_status)
);

CREATE INDEX ix_receipt_review_cases_status_created
  ON receipt_review_cases(status, created_at DESC, id DESC);

CREATE INDEX ix_receipt_review_case_history_case_time
  ON receipt_review_case_history(case_id, created_at, id);

CREATE TRIGGER trg_receipt_review_case_history_immutable
  BEFORE UPDATE OR DELETE ON receipt_review_case_history
  FOR EACH ROW EXECUTE FUNCTION payguard_prevent_mutation();
