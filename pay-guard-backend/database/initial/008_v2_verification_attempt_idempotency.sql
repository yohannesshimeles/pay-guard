-- Durable idempotency identity for every verification attempt.

ALTER TABLE verification_attempts
  ADD COLUMN attempt_key varchar(160);

UPDATE verification_attempts
SET attempt_key = 'legacy:' || id::text
WHERE attempt_key IS NULL;

ALTER TABLE verification_attempts
  ALTER COLUMN attempt_key SET NOT NULL,
  ADD CONSTRAINT uq_verification_attempt_key UNIQUE (attempt_key);
