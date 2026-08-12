-- Verify.ET webhook deduplication and processing state.
-- Raw webhook bodies and signatures are deliberately not retained.

CREATE TABLE verifyet_webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id varchar(160) NOT NULL UNIQUE,
  event_type varchar(100) NOT NULL,
  payload_hash char(64) NOT NULL,
  delivery_status varchar(16) NOT NULL DEFAULT 'RECEIVED'
    CHECK (delivery_status IN ('RECEIVED','PROCESSING','PROCESSED','FAILED')),
  processing_attempts smallint NOT NULL DEFAULT 0
    CHECK (processing_attempts >= 0),
  last_error_code varchar(80),
  signature_verified_at timestamptz NOT NULL DEFAULT now(),
  first_received_at timestamptz NOT NULL DEFAULT now(),
  processing_started_at timestamptz,
  processed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ix_verifyet_webhook_status_time
  ON verifyet_webhook_deliveries(delivery_status, first_received_at);

CREATE INDEX ix_verifyet_webhook_event_time
  ON verifyet_webhook_deliveries(event_type, first_received_at);
