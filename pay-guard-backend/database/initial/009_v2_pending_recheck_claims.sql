-- Durable, lease-based worker claims for pending verification rechecks.

ALTER TABLE pending_rechecks
  DROP CONSTRAINT pending_rechecks_status_check,
  ADD COLUMN claim_token uuid,
  ADD COLUMN claimed_by varchar(120),
  ADD COLUMN claimed_at timestamptz,
  ADD COLUMN claim_expires_at timestamptz,
  ADD COLUMN completed_at timestamptz,
  ADD COLUMN last_error_code varchar(80),
  ADD CONSTRAINT pending_rechecks_status_check
    CHECK (status IN (
      'SCHEDULED','CLAIMED','WAITING_CREDITS','PAUSED_BRANCH',
      'COMPLETED','CANCELLED'
    )),
  ADD CONSTRAINT ck_pending_rechecks_claim_lease
    CHECK (
      (status = 'CLAIMED' AND claim_token IS NOT NULL AND
       claimed_by IS NOT NULL AND claimed_at IS NOT NULL AND
       claim_expires_at IS NOT NULL)
      OR
      (status <> 'CLAIMED' AND claim_token IS NULL AND
       claimed_by IS NULL AND claimed_at IS NULL AND
       claim_expires_at IS NULL)
    ),
  ADD CONSTRAINT ck_pending_rechecks_claim_expiry
    CHECK (claim_expires_at IS NULL OR claim_expires_at > claimed_at),
  ADD CONSTRAINT ck_pending_rechecks_completed_at
    CHECK ((status = 'COMPLETED') = (completed_at IS NOT NULL)),
  ADD CONSTRAINT ck_pending_rechecks_error_code
    CHECK (last_error_code IS NULL OR last_error_code ~ '^[A-Z0-9_]{1,80}$');

CREATE INDEX ix_pending_rechecks_expired_claim
  ON pending_rechecks(claim_expires_at)
  WHERE status = 'CLAIMED';
