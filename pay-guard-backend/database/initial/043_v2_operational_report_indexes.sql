-- Phase 9: operational report access paths.

CREATE INDEX ix_verification_report_business_time
  ON verification_attempts (business_id, created_at, result_status);

CREATE INDEX ix_subscription_report_business_branch_time
  ON subscription_orders (business_id, branch_id, created_at, status);

CREATE INDEX ix_fraud_report_business_branch_time
  ON subscription_fraud_attempts (business_id, branch_id, detected_at);

CREATE INDEX ix_verifyet_request_report_time
  ON verifyet_provider_requests (created_at, request_status, operation);

CREATE INDEX ix_verifyet_response_report_time
  ON verifyet_provider_responses (received_at, http_status);
