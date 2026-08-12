-- Phase 9: durable asynchronous report export and protected download lifecycle.

ALTER TABLE report_generation_jobs
  ADD COLUMN branch_id uuid REFERENCES branches(id),
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN attempt_count smallint NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 3),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(),
  ADD CONSTRAINT ck_report_generation_type CHECK (
    report_type IN ('FINANCIAL_SUMMARY','OPERATIONAL_SUMMARY')
  ),
  ADD CONSTRAINT ck_report_request_context_object CHECK (
    jsonb_typeof(request_context_json) = 'object'
  ),
  ADD CONSTRAINT ck_report_filter_object CHECK (
    jsonb_typeof(filter_json) = 'object'
  );

CREATE UNIQUE INDEX uq_report_job_request_idempotency
  ON report_generation_jobs(requested_by_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_report_job_claim
  ON report_generation_jobs(status, next_attempt_at, created_at)
  WHERE status IN ('QUEUED','PROCESSING');

ALTER TABLE report_files
  ADD COLUMN content_type varchar(100) NOT NULL DEFAULT 'text/csv; charset=utf-8',
  ADD COLUMN sha256 char(64);

CREATE INDEX ix_report_file_expiry
  ON report_files(available_until)
  WHERE deleted_at IS NULL;
