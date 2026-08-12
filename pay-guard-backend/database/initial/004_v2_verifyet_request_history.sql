-- Durable Verify.ET idempotency and sanitized provider request/response history.
-- Raw provider payloads and credentials are intentionally not persisted here.

CREATE TABLE verifyet_provider_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_attempt_id uuid NOT NULL REFERENCES verification_attempts(id),
  operation varchar(20) NOT NULL
    CHECK (operation IN ('SUBMIT','STATUS','EVENTS','HISTORY','TEST_WEBHOOK')),
  idempotency_key varchar(128) NOT NULL UNIQUE,
  request_hash char(64) NOT NULL,
  bank_code varchar(32),
  amount_etb numeric(18,2) CHECK (amount_etb IS NULL OR amount_etb > 0),
  request_status varchar(16) NOT NULL DEFAULT 'RESERVED'
    CHECK (request_status IN ('RESERVED','SENT','SUCCEEDED','FAILED')),
  provider_request_id varchar(120),
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error_code varchar(80),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  completed_at timestamptz
);

CREATE UNIQUE INDEX uq_verifyet_provider_request_id
  ON verifyet_provider_requests(provider_request_id)
  WHERE provider_request_id IS NOT NULL;

CREATE INDEX ix_verifyet_requests_attempt_time
  ON verifyet_provider_requests(verification_attempt_id, created_at);

CREATE INDEX ix_verifyet_requests_status_time
  ON verifyet_provider_requests(request_status, created_at);

CREATE TABLE verifyet_provider_responses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_request_record_id uuid NOT NULL
    REFERENCES verifyet_provider_requests(id),
  http_status smallint NOT NULL CHECK (http_status BETWEEN 100 AND 599),
  provider_status varchar(64),
  response_hash char(64) NOT NULL,
  error_code varchar(80),
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_verifyet_responses_request_time
  ON verifyet_provider_responses(provider_request_record_id, received_at);
