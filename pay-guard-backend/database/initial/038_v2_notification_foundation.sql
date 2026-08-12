-- Phase 8: durable, recipient-isolated notification foundation.

CREATE TABLE notification_templates (
  template_key varchar(80) PRIMARY KEY,
  notification_type varchar(40) NOT NULL,
  title_template varchar(180) NOT NULL,
  message_template text NOT NULL,
  required_variables jsonb NOT NULL DEFAULT '[]'::jsonb,
  default_push_enabled boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (jsonb_typeof(required_variables) = 'array')
);

INSERT INTO notification_templates (
  template_key, notification_type, title_template, message_template,
  required_variables
) VALUES
  ('SUBSCRIPTION_FRAUD_ALERT', 'FRAUD_ALERT',
   'Subscription fraud alert',
   'Cross-day payment proof reuse was detected for business {{businessId}} (attempt {{attemptNumber}}).',
   '["businessId", "attemptNumber"]'::jsonb),
  ('CREDIT_THRESHOLD_ALERT', 'CREDIT_ALERT',
   'Branch credit threshold reached',
   'Branch {{branchId}} has {{remainingCredits}} credits remaining.',
   '["branchId", "remainingCredits"]'::jsonb),
  ('PROVIDER_INCIDENT_ALERT', 'INCIDENT_ALERT',
   'Verification provider incident',
   'Verification provider {{provider}} is experiencing {{incidentType}}.',
   '["provider", "incidentType"]'::jsonb);

ALTER TABLE notifications
  ALTER COLUMN recipient_user_id DROP NOT NULL,
  ADD COLUMN recipient_platform_admin_id uuid REFERENCES platform_admin(id),
  ADD COLUMN template_key varchar(80) REFERENCES notification_templates(template_key),
  ADD COLUMN branch_id uuid REFERENCES branches(id),
  ADD COLUMN idempotency_key varchar(180),
  ADD COLUMN variables_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD CONSTRAINT ck_notification_exact_recipient CHECK (
    (recipient_user_id IS NOT NULL)::integer +
    (recipient_platform_admin_id IS NOT NULL)::integer = 1
  ),
  ADD CONSTRAINT ck_notification_variables_object
    CHECK (jsonb_typeof(variables_json) = 'object');

CREATE UNIQUE INDEX uq_notifications_idempotency
  ON notifications(idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX ix_notifications_platform_admin_visible
  ON notifications(recipient_platform_admin_id, visible_until, is_read)
  WHERE recipient_platform_admin_id IS NOT NULL;

CREATE TABLE notification_preferences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  platform_admin_id uuid REFERENCES platform_admin(id),
  notification_type varchar(40) NOT NULL,
  in_app_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL)::integer +
         (platform_admin_id IS NOT NULL)::integer = 1)
);

CREATE UNIQUE INDEX uq_notification_preferences_user
  ON notification_preferences(user_id, notification_type)
  WHERE user_id IS NOT NULL;

CREATE UNIQUE INDEX uq_notification_preferences_platform_admin
  ON notification_preferences(platform_admin_id, notification_type)
  WHERE platform_admin_id IS NOT NULL;

ALTER TABLE notification_delivery_attempts
  ADD COLUMN provider varchar(32),
  ADD COLUMN provider_message_id varchar(180),
  ADD COLUMN failure_code varchar(80),
  ADD COLUMN retry_at timestamptz;

