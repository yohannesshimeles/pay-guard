-- Durable provider pause state and idempotent operational security alerts.

ALTER TABLE pending_rechecks
  DROP CONSTRAINT pending_rechecks_status_check,
  ADD CONSTRAINT pending_rechecks_status_check
    CHECK (status IN (
      'SCHEDULED','CLAIMED','WAITING_CREDITS','PAUSED_BRANCH',
      'PAUSED_PROVIDER','COMPLETED','CANCELLED'
    ));

ALTER TABLE security_alerts
  ADD COLUMN alert_key varchar(160);

CREATE UNIQUE INDEX uq_security_alert_key
  ON security_alerts(alert_key)
  WHERE alert_key IS NOT NULL;
