-- Phase 8: sanitized financial and reconciliation notifications.

INSERT INTO notification_templates (
  template_key, notification_type, title_template, message_template,
  required_variables
) VALUES
  ('FINANCIAL_OPERATION_EVENT', 'FINANCIAL_EVENT',
   'Branch financial activity',
   'A {{operation}} record was posted for branch {{branchId}}.',
   '["operation", "branchId"]'::jsonb),
  ('RECONCILIATION_STATUS_EVENT', 'RECONCILIATION_EVENT',
   'Reconciliation update',
   'Branch {{branchId}} reconciliation is now {{status}}.',
   '["branchId", "status"]'::jsonb)
ON CONFLICT (template_key) DO NOTHING;

