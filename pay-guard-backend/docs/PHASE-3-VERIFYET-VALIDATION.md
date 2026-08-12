# Phase 3 Verify.ET Validation

Date: 2026-08-06  
Status: Increments 1-4 implemented; final vendor contract and credentials pending

## Increment 1 - Disabled-by-default provider security boundary

Implemented:

- Verify.ET integration is disabled unless explicitly enabled through validated
  environment configuration.
- Enabled mode requires an HTTPS base URL without embedded credentials, query or
  fragment and a managed API key of at least 32 characters.
- The provider API key must be distinct from JWT, account-encryption and object-
  storage secrets.
- Provider timeout is bounded to 500-30,000 ms and response bodies are configured
  with a 1 KiB-1 MiB limit for the future transport adapter.
- Credential access is isolated inside `VerifyEtModule`; disabled access fails closed
  with a sanitized error.
- HTTP status policy maps 401, 402, 403, 409, 422, 429 and 503 to stable internal
  error codes without retaining provider response bodies.
- Network failures and unknown 5xx responses are retryable; authentication, credit,
  forbidden, conflict and validation failures are not.
- `Retry-After` delta-seconds and HTTP-date values are parsed and capped at 24 hours.

Contract boundary:

- No endpoint path, authorization header scheme, payload shape or webhook signature
  algorithm is guessed in source.
- No API route, worker or scheduled job can contact Verify.ET in this increment.
- `VERIFYET_ENABLED` remains `false` until the final vendor contract and non-exposed
  test credentials are supplied.

Validation evidence:

- [x] Focused configuration, credential and error-policy validation passes: 3 suites
  and 18 tests.
- [x] Every PDF-defined provider status has an explicit mapping test.
- [x] Error messages contain no API key, provider body or raw network detail.
- [x] Lint and production build pass.
- [x] Full unit regression passes: 31 suites and 159 tests.
- [x] No dependency or lockfile changes.

## Increment 2 - Idempotency and sanitized provider history

Implemented:

- A globally unique idempotency key reserves each logical provider request before
  any future network call is allowed.
- Reusing a key is accepted only when the verification attempt, provider operation
  and canonical SHA-256 request hash are identical. Conflicting reuse fails closed.
- The request lifecycle is persisted as `RESERVED`, `SENT`, `SUCCEEDED` or `FAILED`,
  with an attempt counter and guarded provider-request identifier.
- Provider responses retain only bounded metadata and a canonical SHA-256 hash.
  Raw request/response payloads and credentials are not stored.
- Response-history insertion and request completion occur in one database
  transaction, so either both changes commit or neither does.
- Migration `004_v2_verifyet_request_history.sql` adds the durable request/response
  history tables, constraints and operational indexes.

Validation evidence:

- [x] Focused idempotency and payload-hash validation passes: 2 suites and 16 tests.
- [x] Replay, conflict, invalid-input and guarded lifecycle paths are tested.
- [x] Tests confirm sensitive request and response fields are replaced by hashes
  before database parameters are constructed.
- [x] Lint and production build pass.
- [x] Full unit regression passes: 33 suites and 175 tests.
- [x] Migration `004` applied to the local V2 database.
- [x] No dependency or lockfile changes.

## Increment 3 - Webhook verification boundary and delivery deduplication

Implemented:

- A provider-neutral signature-verifier interface receives the exact raw bytes and
  headers required by a future vendor implementation.
- The registered default verifier always denies delivery, so no webhook is accepted
  until the documented Verify.ET signing contract is implemented.
- Webhook intake is disabled with the rest of Verify.ET and enforces non-empty,
  bounded raw bodies before invoking signature verification.
- Only successfully verified delivery metadata reaches persistence.
- Delivery identifiers are globally unique. Exact redelivery is recognized, while
  reuse with a different event type or raw-body SHA-256 hash fails closed.
- Atomic state transitions allow only `RECEIVED` or `FAILED` deliveries to become
  `PROCESSING`, and only `PROCESSING` deliveries to become `PROCESSED` or `FAILED`.
  A processed delivery therefore cannot be claimed again.
- Migration `005_v2_verifyet_webhook_deliveries.sql` stores hashes and bounded
  operational metadata only; raw bodies and signatures are never retained.

Validation evidence:

- [x] Focused signature-boundary and deduplication validation passes: 2 suites and
  13 tests.
- [x] Invalid signatures cannot create database records.
- [x] Duplicate, conflicting, concurrent-claim and invalid-transition paths are
  tested.
- [x] Lint and production build pass.
- [x] Full unit regression passes: 35 suites and 188 tests.
- [x] Database-backed V2 regression passes: 1 suite and 7 integration tests.
- [x] Migration `005` applied successfully to the local `payguard_v2` database.
- [x] No dependency or lockfile changes.

Contract boundary:

- No signature header, digest algorithm, signed message format, timestamp header or
  tolerance is guessed.
- No public webhook controller is exposed until those values and official fixtures
  are available.

## Increment 4 - Polling, retry and returned status-URL policy

Implemented:

- Polling is limited to a configurable 1-20 attempts, with a default of six.
- Exponential delays use deterministic per-request jitter to avoid synchronized
  retries while remaining reproducible for tests and operations.
- Normal polling delay is bounded by a configurable maximum. A validated
  `Retry-After` value takes precedence as the provider-required minimum and remains
  capped at 24 hours by the existing error policy.
- Non-retryable provider errors stop immediately; exhausted requests receive an
  explicit terminal decision.
- Returned absolute and relative status URLs are resolved through a single policy.
  Only HTTPS URLs on the configured Verify.ET origin are accepted.
- Cross-origin, downgraded HTTP, credential-bearing, fragmented, malformed and
  oversized returned URLs fail closed, preventing status-URL SSRF and authority
  confusion.
- Poll settings are validated at startup and documented in `.env.example`.

Validation evidence:

- [x] Focused configuration, polling and URL-policy validation passes: 4 suites and
  25 tests.
- [x] Lint and production build pass.
- [x] Full unit regression passes: 37 suites and 204 tests.
- [x] Database-backed V2 regression passes: 1 suite and 7 integration tests.
- [x] No migration, dependency or lockfile changes.

Contract boundary:

- The transport worker is not enabled because submit/status endpoint schemas and
  terminal/pending provider status values are still unavailable.
- Returned status URLs are validated but are not persisted because the vendor has
  not confirmed whether they contain bearer credentials or how they are renewed.

## Required next inputs

- Verify.ET test base URL and endpoint paths.
- API authentication header/scheme specification.
- Submit/status/events/history request and response schemas.
- Webhook signing algorithm, signed bytes, timestamp tolerance and delivery-ID field.
- Provider contract fixtures for every documented success and error response.
