-- Extend V2 audit records to cover the separate Platform Super Admin identity.

ALTER TABLE audit_logs
  ADD COLUMN platform_admin_id uuid REFERENCES platform_admin(id),
  ADD COLUMN platform_admin_session_id uuid REFERENCES platform_admin_sessions(id),
  ADD CONSTRAINT ck_audit_single_actor
    CHECK (num_nonnulls(user_id, platform_admin_id) <= 1),
  ADD CONSTRAINT ck_audit_single_session
    CHECK (num_nonnulls(session_id, platform_admin_session_id) <= 1);

CREATE INDEX ix_audit_platform_admin_time
  ON audit_logs(platform_admin_id, created_at DESC)
  WHERE platform_admin_id IS NOT NULL;
