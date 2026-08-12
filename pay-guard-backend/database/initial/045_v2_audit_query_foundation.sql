-- Phase 9 audit foundation: request correlation and query indexes.

ALTER TABLE audit_logs
  ADD COLUMN correlation_id varchar(128) NOT NULL DEFAULT 'system',
  ADD CONSTRAINT ck_audit_correlation_id
    CHECK (correlation_id ~ '^[a-zA-Z0-9._-]{6,128}$'),
  ADD CONSTRAINT ck_audit_previous_value_object
    CHECK (previous_value IS NULL OR jsonb_typeof(previous_value) = 'object'),
  ADD CONSTRAINT ck_audit_new_value_object
    CHECK (new_value IS NULL OR jsonb_typeof(new_value) = 'object');

CREATE INDEX ix_audit_business_branch_time
  ON audit_logs(business_id, branch_id, created_at DESC, id DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX ix_audit_record_time
  ON audit_logs(record_type, record_id, created_at DESC)
  WHERE record_id IS NOT NULL;

CREATE INDEX ix_audit_correlation
  ON audit_logs(correlation_id, created_at DESC);
