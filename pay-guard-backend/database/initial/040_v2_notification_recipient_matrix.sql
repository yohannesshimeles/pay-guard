-- Phase 8: role-scoped templates for existing operational events.

INSERT INTO notification_templates (
  template_key, notification_type, title_template, message_template,
  required_variables
) VALUES
  ('TRANSACTION_STATUS_UPDATE', 'TRANSACTION_UPDATE',
   'Payment verification update',
   'Your submitted payment is now {{status}}.',
   '["status"]'::jsonb),
  ('CREDIT_USAGE_THRESHOLD', 'CREDIT_ALERT',
   'Branch credit usage alert',
   'Branch {{branchId}} reached {{thresholdPercent}}% credit usage; {{remainingCredits}} remain.',
   '["branchId", "thresholdPercent", "remainingCredits"]'::jsonb),
  ('WAITER_DEVICE_SESSION', 'DEVICE_EVENT',
   'Device session started',
   'A {{platform}} device session was started for your Waiter account.',
   '["platform"]'::jsonb)
ON CONFLICT (template_key) DO NOTHING;
