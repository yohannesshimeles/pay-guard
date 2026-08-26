-- Phase 9: encrypted receipt-evidence archive lifecycle.

ALTER TABLE archive_jobs
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 3),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX ix_archive_jobs_claim
  ON archive_jobs(status, next_attempt_at, job_month)
  WHERE status IN ('QUEUED', 'RUNNING');

CREATE TABLE archive_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_job_id uuid NOT NULL REFERENCES archive_jobs(id),
  source_type varchar(40) NOT NULL CHECK (source_type = 'TRANSACTION_RECEIPT'),
  storage_object_key text NOT NULL UNIQUE,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes > 0),
  encrypted_sha256 char(64) NOT NULL,
  plaintext_sha256 char(64) NOT NULL,
  encryption_algorithm varchar(40) NOT NULL CHECK (encryption_algorithm = 'AES-256-GCM'),
  manifest_json jsonb NOT NULL,
  record_count integer NOT NULL CHECK (record_count > 0),
  verified_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE archive_batch_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_batch_id uuid NOT NULL REFERENCES archive_batches(id),
  source_type varchar(40) NOT NULL CHECK (source_type = 'TRANSACTION_RECEIPT'),
  source_record_id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES businesses(id),
  branch_id uuid REFERENCES branches(id),
  source_created_at timestamptz NOT NULL,
  archived_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_record_id)
);

CREATE INDEX ix_archive_records_scope_time
  ON archive_batch_records(business_id, branch_id, source_created_at DESC);

CREATE TABLE archive_source_deletions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_batch_record_id uuid NOT NULL UNIQUE REFERENCES archive_batch_records(id),
  storage_object_key text NOT NULL,
  attempt_count smallint NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  last_failure_code varchar(80),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_archive_source_deletions_due
  ON archive_source_deletions(next_attempt_at, id)
  WHERE deleted_at IS NULL;

CREATE TABLE archive_retrieval_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  archive_batch_record_id uuid NOT NULL REFERENCES archive_batch_records(id),
  retrieved_by_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  reason text NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 10 AND 500),
  integrity_verified boolean NOT NULL,
  retrieved_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_archive_retrieval_record_time
  ON archive_retrieval_history(archive_batch_record_id, retrieved_at DESC);
