-- Platform-admin acknowledgement metadata for sanitized provider incidents.

ALTER TABLE security_alerts
  ADD COLUMN acknowledged_at timestamptz,
  ADD COLUMN acknowledged_by_platform_admin_id uuid REFERENCES platform_admin(id),
  ADD COLUMN acknowledgement_note varchar(500),
  ADD CONSTRAINT ck_security_alert_acknowledgement
    CHECK (
      (acknowledged_at IS NULL AND acknowledged_by_platform_admin_id IS NULL)
      OR
      (acknowledged_at IS NOT NULL AND acknowledged_by_platform_admin_id IS NOT NULL)
    );

CREATE INDEX ix_security_alerts_type_created
  ON security_alerts(alert_type, created_at DESC, id DESC);
