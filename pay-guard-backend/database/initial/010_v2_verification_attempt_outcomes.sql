-- Provider outcome identity and finalized-attempt consistency.

CREATE UNIQUE INDEX uq_verification_attempt_provider_request_id
  ON verification_attempts(provider_request_id)
  WHERE provider_request_id IS NOT NULL;

ALTER TABLE verification_attempts
  ADD CONSTRAINT ck_verification_attempt_finalized_response
    CHECK (
      result_status = 'QUEUED'
      OR
      (provider_request_id IS NOT NULL AND provider_status IS NOT NULL AND
       requested_at IS NOT NULL AND responded_at IS NOT NULL AND
       responded_at >= requested_at AND response_time_ms IS NOT NULL)
    ),
  ADD CONSTRAINT ck_verification_attempt_error_code
    CHECK (error_code IS NULL OR error_code ~ '^[A-Z0-9_]{1,80}$');
