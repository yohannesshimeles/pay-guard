-- Phase 8 durable Platform Super Admin alerts for subscription fraud evidence.

ALTER TABLE subscription_fraud_attempts
  ADD COLUMN fraud_alert_id uuid UNIQUE REFERENCES security_alerts(id);

CREATE INDEX ix_subscription_fraud_review_status
  ON fraud_flags(status, created_at DESC, id DESC)
  WHERE event_type IN ('CROSS_DAY_DUPLICATE', 'THREE_DUPLICATES');

CREATE INDEX ix_security_alerts_fraud_business
  ON security_alerts(business_id, created_at DESC, id DESC)
  WHERE alert_type = 'SUBSCRIPTION_CROSS_DAY_REUSE';

