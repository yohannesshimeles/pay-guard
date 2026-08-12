-- Phase 8: encrypted push devices and lease-based delivery processing.

CREATE TABLE notification_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES users(id),
  platform_admin_id uuid REFERENCES platform_admin(id),
  platform varchar(16) NOT NULL CHECK (platform IN ('android','ios','web')),
  token_ciphertext text NOT NULL,
  token_iv varchar(32) NOT NULL,
  token_auth_tag varchar(32) NOT NULL,
  token_fingerprint char(64) NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  last_registered_at timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((user_id IS NOT NULL)::integer +
         (platform_admin_id IS NOT NULL)::integer = 1),
  CHECK ((is_active AND deactivated_at IS NULL) OR NOT is_active)
);

CREATE UNIQUE INDEX uq_notification_devices_active_user
  ON notification_devices(user_id)
  WHERE user_id IS NOT NULL AND is_active;

CREATE UNIQUE INDEX uq_notification_devices_active_platform_admin
  ON notification_devices(platform_admin_id)
  WHERE platform_admin_id IS NOT NULL AND is_active;

ALTER TABLE notifications
  ADD COLUMN push_claim_token uuid,
  ADD COLUMN push_claimed_at timestamptz,
  ADD COLUMN push_last_error_code varchar(80);

ALTER TABLE notification_delivery_attempts
  ADD COLUMN notification_device_id uuid REFERENCES notification_devices(id);

CREATE INDEX ix_notifications_push_claim
  ON notifications(push_status, created_at)
  WHERE push_status IN ('PENDING','SENDING');

