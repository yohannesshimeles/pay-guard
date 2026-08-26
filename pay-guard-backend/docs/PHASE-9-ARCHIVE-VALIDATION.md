# Phase 9 Archive Validation

## Increment 1 - encrypted transaction receipt archive

Implemented:

- migration `046_v2_receipt_archive_lifecycle.sql` adds durable batches, batch-record
  catalogue entries, protected-source deletion retries and retrieval history;
- the worker selects only active transaction receipts older than one PostgreSQL year;
- every source evidence object is checked against its stored size and SHA-256 before
  packaging;
- packages use application-level AES-256-GCM authenticated encryption with a distinct
  production-managed key, in addition to object-storage server-side encryption;
- the worker reads the uploaded package back, verifies encrypted and plaintext
  checksums, decrypts it and validates every evidence hash before marking source rows
  archived;
- active receipt and transaction queries continue to exclude archived evidence;
- source object deletion happens only after the verified batch commits and has a
  separate durable ten-attempt retry lifecycle;
- only the isolated Platform Super Admin identity can list batches or retrieve a
  record, and retrieval requires a review reason;
- every retrieval re-verifies the package and record integrity before returning bytes;
- batch success/failure, source deletion success/failure and retrieval are immutable
  system/admin audit events without storage keys or encryption secrets.

Endpoints:

- `GET /api/v1/platform/archive/batches`;
- `POST /api/v1/platform/archive/batches/:batchId/records/:recordId/retrieve`.

Validation:

- archive crypto tests cover authenticated round-trip and ciphertext tampering;
- worker tests cover verified packaging, source corruption compensation and delayed
  source deletion;
- service tests cover forged-role denial, authorized audited retrieval and corrupted
  archive rejection;
- the pre-existing retention DAO tests continue to prove one-year eligibility and
  active-query exclusion;
- the clean V2 integration schema now includes migration 046.
- the object-storage exercise passed against PostgreSQL 16 and a KMS-enabled MinIO
  S3 endpoint using a 16 MiB receipt: archive completed in 1.264 seconds, retrieval
  completed in 0.482 seconds, the retrieved bytes and SHA-256 matched, the source
  object was absent after verified deletion, and all three lifecycle audit actions
  were present;
- `npm run test:phase9:archive` provides the repeatable `_test`-database-guarded
  infrastructure harness.

Operational gate still required before production:

- provision a distinct managed `ARCHIVE_ENCRYPTION_KEY` and approve its rotation and
  disaster-recovery procedure, then run the managed-key recovery drill.

Local recovery readiness now also includes versioned archive encryption envelopes,
current/previous managed-key configuration, old-key retrieval tests, authenticated
encrypted PostgreSQL backup restoration, and exact post-restore archive retrieval.
These do not substitute for executing the drill with the production key manager.
