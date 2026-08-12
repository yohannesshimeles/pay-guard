-- Secure refresh-token persistence for the V2 identity model.
-- Existing active sessions are expired because they predate refresh-token hashing.

ALTER TABLE user_sessions
  ADD COLUMN refresh_token_hash char(64),
  ADD COLUMN device_identifier_hash char(64),
  ADD COLUMN device_platform varchar(32),
  ADD COLUMN rotated_at timestamptz;

UPDATE user_sessions
SET session_status = 'EXPIRED',
    revoked_at = COALESCE(revoked_at, now()),
    revoked_reason = COALESCE(revoked_reason, 'V2 secure-session migration')
WHERE session_status = 'ACTIVE';

ALTER TABLE user_sessions
  ADD CONSTRAINT ck_active_user_session_refresh_token
  CHECK (session_status <> 'ACTIVE' OR refresh_token_hash IS NOT NULL),
  ADD CONSTRAINT ck_user_session_device_platform
  CHECK (device_platform IS NULL OR device_platform IN ('web','android','ios'));

CREATE UNIQUE INDEX uq_active_user_session_refresh_token
  ON user_sessions(refresh_token_hash)
  WHERE refresh_token_hash IS NOT NULL AND session_status = 'ACTIVE';

CREATE INDEX ix_user_sessions_active_user
  ON user_sessions(user_id, expires_at)
  WHERE session_status = 'ACTIVE';

CREATE TABLE platform_admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform_admin_id uuid NOT NULL REFERENCES platform_admin(id),
  refresh_token_hash char(64) NOT NULL,
  device_identifier_hash char(64),
  device_platform varchar(32)
    CHECK (device_platform IS NULL OR device_platform IN ('web','android','ios')),
  session_status varchar(16) NOT NULL DEFAULT 'ACTIVE'
    CHECK (session_status IN ('ACTIVE','REVOKED','EXPIRED')),
  login_at timestamptz NOT NULL DEFAULT now(),
  last_active_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text,
  CHECK (expires_at > login_at)
);

CREATE UNIQUE INDEX uq_active_platform_admin_session_refresh_token
  ON platform_admin_sessions(refresh_token_hash)
  WHERE session_status = 'ACTIVE';

CREATE INDEX ix_platform_admin_sessions_active_admin
  ON platform_admin_sessions(platform_admin_id, expires_at)
  WHERE session_status = 'ACTIVE';
