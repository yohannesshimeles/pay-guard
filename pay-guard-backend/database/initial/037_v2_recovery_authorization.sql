-- Phase 8 secure, expiring and revocable Recovery Authorization Codes.

ALTER TABLE recovery_codes
  ADD COLUMN request_key uuid,
  ADD COLUMN expires_at timestamptz NOT NULL DEFAULT (now() + interval '15 minutes'),
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN revoked_by_admin_id uuid REFERENCES platform_admin(id),
  ADD COLUMN revocation_reason varchar(500),
  ADD CONSTRAINT uq_recovery_code_request UNIQUE (request_key),
  ADD CONSTRAINT uq_recovery_code_hash UNIQUE (code_hash),
  ADD CONSTRAINT ck_recovery_code_expiry CHECK (expires_at > generated_at),
  ADD CONSTRAINT ck_recovery_code_terminal_state CHECK (
    (status = 'ACTIVE' AND used_at IS NULL AND used_by_user_id IS NULL
      AND revoked_at IS NULL AND revoked_by_admin_id IS NULL)
    OR
    (status = 'USED' AND used_at IS NOT NULL AND used_by_user_id IS NOT NULL
      AND revoked_at IS NULL AND revoked_by_admin_id IS NULL)
    OR
    (status = 'REVOKED' AND used_at IS NULL AND used_by_user_id IS NULL
      AND revoked_at IS NOT NULL AND revoked_by_admin_id IS NOT NULL
      AND revocation_reason IS NOT NULL)
  );

UPDATE recovery_codes SET request_key = gen_random_uuid()
WHERE request_key IS NULL;

ALTER TABLE recovery_codes ALTER COLUMN request_key SET NOT NULL;

CREATE UNIQUE INDEX uq_active_recovery_code_per_lock
  ON recovery_codes(purchase_lock_id)
  WHERE status = 'ACTIVE';

CREATE INDEX ix_recovery_code_business_status
  ON recovery_codes(business_id, status, generated_at DESC);
