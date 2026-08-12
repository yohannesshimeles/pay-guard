# Phase 3 Implementation Validation

Date: 2026-08-06  
Status: Increments 1-11 implemented; approved bank-fixture validation pending

## Increment 1 - Secure proof validation boundary

Delivered:

- A reusable proof-file validator for JPG/JPEG, PNG and PDF.
- Exact MIME allowlisting plus matching filename-extension validation.
- Magic-byte validation so a declared content type is not trusted by itself.
- Empty-file, configurable size-limit, path-separator and control-character
  rejection.
- SHA-256 evidence hashing for later receipt persistence and duplicate analysis.
- Explicit `NO_QR`, `SINGLE_QR` and `MULTIPLE_QR` extraction states.
- No automatic multiple-QR selection while the product policy remains unconfirmed.
- Database-aligned enums for proof MIME type, submission method, malware-scan status
  and QR extraction state.
- Typed proof-file, malware-scan, stored-proof, QR-extraction and public-receipt
  models.
- A transaction-receipt domain entity aligned with `transaction_receipts`.
- A safe public receipt projection that excludes the protected object key, evidence
  hash and submitting-user identifier.
- A globally available central DAO boundary with parameterized `one`, `optional`,
  `many`, `execute` and managed-transaction operations.
- A module-specific transaction-receipt DAO for insert, lookup and transaction-
  scoped listing, backed by the central DAO rather than direct pool ownership.

Validation evidence:

- [x] ESLint passed.
- [x] Nest production build passed.
- [x] Unit regression passed: 22 suites and 107 tests.
- [x] Valid JPG, JPEG, PNG and PDF fixtures are accepted.
- [x] Unsupported MIME, extension/MIME mismatch and forged magic bytes are rejected.
- [x] Empty, oversized and unsafe-filename inputs are rejected.
- [x] Zero, one and multiple candidate outcomes are deterministic.
- [x] Receipt public mapping does not expose internal storage or hashing metadata.
- [x] Central DAO cardinality checks, affected-row counts, parameter forwarding and
      transaction delegation pass unit tests.

## Increment 2 - Secure proof intake orchestration

Delivered:

- Fail-closed malware-scanner and QR-decoder ports with no vendor coupling in the
  domain service.
- Strict validate, scan and decode ordering; infected or unavailable scans never
  reach the decoder or storage.
- Sanitized infected, scanner-unavailable and unsupported-proof outcomes.
- Server-generated private object keys that do not contain user filenames, business
  names or account identifiers.
- Receipt metadata persistence through `TransactionReceiptDao`.
- Compensating private-object deletion when database receipt persistence fails.
- S3-compatible object deletion support for compensation and later retention jobs.

Validation evidence:

- [x] Clean proof reaches the decoder and returns a deterministic extraction state.
- [x] Infected and scanner-error results fail closed before decoding.
- [x] Unsupported proof does not invent QR content.
- [x] Only server-generated private keys are sent to object storage.
- [x] Database failure triggers object-storage compensation.
- [x] Lint, production build and the full 103-test unit regression pass.

## Required next increment

- Add authenticated multipart intake with streaming limits.
- Store only validated, malware-cleared evidence under a server-generated private
  object key.
- Persist receipt metadata without exposing the protected object key to clients.

## Increment 3 - ClamAV malware adapter

Delivered:

- A dependency-free TCP `clamd` adapter using the documented null-terminated
  `INSTREAM` protocol and length-prefixed chunks.
- Bounded scanner response size, configurable chunk size and strict socket timeout.
- Clean, infected and scanner-error mapping into the existing fail-closed port.
- Sanitized connection, timeout, incomplete-response and malformed-response handling.
- An opt-in Docker Compose `phase3` profile using the official ClamAV 1.5 feature
  release image and a persistent signature database volume.

Validation evidence:

- [x] Protocol test maps `OK` to `CLEAN`.
- [x] Protocol test maps `FOUND` to `INFECTED` with an internal signature reference.
- [x] Abrupt disconnect and no-response timeout both map to `ERROR`.
- [x] Lint, production build and all 22 unit suites (107 tests) pass.

Local runtime:

```cmd
docker compose --profile phase3 up -d clamav
```

ClamAV signature loading is memory intensive. Allocate sufficient Docker memory
before enabling this profile and do not expose port 3310 outside a trusted local or
private service network in deployed environments.

## Increment 4 - Bounded image QR decoding

Delivered:

- JPEG and PNG rasterization through Sharp with strict input-pixel, processing-time
  and output-shape limits.
- QR extraction through jsQR without logging or returning raw QR values from an HTTP
  boundary.
- Inverted-image scanning disabled to reduce CPU amplification; approved real-bank
  fixtures can justify enabling a bounded second attempt later.
- PDF is explicitly reported as unsupported until the separate bounded PDF-page
  rasterizer is implemented.
- Decoder/native errors are converted to a sanitized validation response.

Validation evidence:

- [x] PDF bypasses the image parser and returns `UNSUPPORTED_PROOF` input.
- [x] No-code and single-code outcomes are deterministic.
- [x] Unsafe dimensions and native parser errors fail safely.
- [x] Install and lock `sharp@0.35.3` and `jsqr@1.4.0`.
- [x] Full unit regression passes: 23 suites and 112 tests.
- [x] Production dependency audit after the image-decoder lockfile update reports
      zero vulnerabilities.
- [ ] Add approved bank receipt fixtures; fixtures must contain synthetic account
      data and remain non-production evidence.

## Increment 5 - Authenticated multipart receipt intake

Implemented:

- Authenticated `POST /api/v1/transactions/:transactionId/receipts` route.
- Exactly one multipart file field named `proof`; non-file fields are rejected.
- 10 MiB streaming parser limit before validation, malware scanning or storage.
- V2-only route guard plus business, branch and Waiter ownership checks before
  expensive processing.
- Safe response containing public receipt metadata, extraction state and candidate
  count only; raw QR values, hashes and object keys are never returned.
- Sanitized malformed-multipart and file-too-large errors.

Pending validation:

- [x] Install and lock `@fastify/multipart@10.1.0`.
- [x] Controller/access tests pass: 2 suites and 8 tests cover V2 gating,
      authorization scope, protected-data redaction and sanitized file-limit errors.
- [x] Full lint and production build pass after installation.
- [x] Full unit regression passes: 25 suites and 120 tests.
- [x] Production dependency audit reports zero vulnerabilities.

## Increment 6 - Structured QR payload parsing

Implemented:

- Internal, dependency-free parser for URL and key/value QR payloads.
- Explicit profiles for CBE, BOA, Telebirr, M-Pesa, CBE Birr, Dashen, Awash,
  Siinqee, Kaafi Ebirr and unsupported Zemen direct verification.
- Strict parsing for reference, ETB amount, ISO date, time, receipt token, phone and
  account suffix without floating-point money conversion.
- Conflicting aliases produce `AMBIGUOUS`; no value is silently selected.
- URL payloads are parsed only; the backend never follows or fetches embedded links.
- Structured payload remains internal to the intake pipeline and is not included in
  the upload response.

Pending validation:

- [x] Lint and production build pass.
- [x] Full unit regression passes: 26 suites and 135 tests.
- [ ] Replace synthetic fixtures with approved, redacted bank samples before marking
      bank-format compatibility complete.

## Increment 7 - Bounded multiple-QR detection

Implemented:

- Repeated QR detection with location masking so separate codes are surfaced instead
  of silently selecting the first.
- Hard limit of four decoder passes per image to bound CPU cost.
- Duplicate-location termination prevents a decoder from looping on the same code.
- Invalid/non-finite QR geometry fails through the existing sanitized decoder error.
- Multiple candidates continue into the existing `MULTIPLE_QR` policy state; no
  candidate is automatically selected.

PDF compatibility decision:

- Current PDF.js releases require Node 22+, while PayGuard currently guarantees Node
  20.19+. The backend will not silently raise its production runtime or introduce an
  outdated PDF parser. PDF remains `UNSUPPORTED_PROOF` until a separately bounded,
  Node-20-compatible rendering worker is validated.

Pending validation:

- [x] Lint and production build pass.
- [x] Full unit regression passes: 26 suites and 137 tests.

## Increment 8 - Isolated PDF QR worker

Implemented:

- PDF.js 5.4 compatibility line pinned for Node 20.19; no backend runtime upgrade.
- PDF parsing, canvas rendering and QR decoding execute in a worker thread rather
  than the Nest request thread.
- Worker has a 10-second termination deadline, 256 MiB old-generation limit,
  32 MiB young-generation limit and 4 MiB stack limit.
- Maximum three PDF pages, 16 million pixels per page and four QR candidates per
  document.
- PDF JavaScript evaluation and system-font loading are disabled.
- Worker details never cross the API boundary; failures map to a sanitized 422.

Validation evidence:

- [x] Install and lock `pdfjs-dist@5.4.394` and `@napi-rs/canvas@0.1.80`.
- [x] Worker asset is copied to `dist/qr-processing/workers/pdf-qr-worker.mjs`.
- [x] Worker client/adapter focused regression passes: 2 suites and 5 tests.
- [x] Lint, build and full unit regression pass: 28 suites and 142 tests.
- [x] Production dependency audit reports zero vulnerabilities.

## Increment 9 - Real PDF worker compatibility validation

Implemented:

- Deterministic in-memory PDF fixture containing a QR with synthetic-only payment
  data; no production receipt or customer data is committed.
- Dedicated `test:pdf-worker` gate exercises PDF parsing, native canvas rendering,
  worker-thread isolation and QR extraction together.
- Explicit native `Path2D` binding alignment between PDF.js and `@napi-rs/canvas`;
  this fixes the ESM/CommonJS constructor mismatch found only by the real fixture.
- The fixture has one bounded page, an explicit four-module quiet zone and no
  JavaScript, network dependency, font dependency or embedded external resource.

Validation evidence:

- [x] The generated PDF was rendered to PNG and visually inspected successfully.
- [x] The production worker extracts the exact expected synthetic payload.
- [x] Dedicated real-worker gate passes: 1 suite and 1 end-to-end test.
- [x] Lint and production build pass.
- [x] Full unit regression remains green: 28 suites and 142 tests.
- [x] Production audit remains at zero known vulnerabilities; no dependencies or
      lockfile entries changed in this compatibility fix.

## Increment 10 - Hostile PDF limits and managed worker lifecycle

Implemented:

- One bounded, application-scoped PDF worker is reused instead of repeatedly loading
  and unloading the native canvas runtime for every upload.
- An explicit readiness handshake separates the one-time native worker startup from
  document processing: startup fails closed after 60 seconds, while each queued PDF
  retains the strict 10-second processing deadline after readiness.
- PDF jobs are serialized inside the worker to prevent concurrent native renderer
  execution while API requests retain independent correlation identifiers and
  deadlines.
- A timeout, invalid response, worker error or unexpected exit rejects every queued
  request and permanently fails PDF decoding closed until application restart.
- Nest application shutdown explicitly rejects pending work and terminates the
  worker.
- PDF document and page resources are released in `finally` paths, including parser,
  page-limit, pixel-limit and render failures.
- Rejected inspection cannot call receipt persistence or protected object storage.

Validation evidence:

- [x] Real synthetic QR PDF still decodes to its exact expected payload.
- [x] Structurally malformed PDF is rejected as `PDF_REJECTED` internally and remains
  a sanitized 422 at the adapter boundary.
- [x] Four-page PDF is rejected before rendering by the three-page limit.
- [x] Oversized page is rejected before canvas allocation by the 16-million-pixel
  limit.
- [x] Dedicated native-worker gate passes: 1 suite and 4 tests.
- [x] Cold native initialization no longer consumes the per-document processing
  deadline or disables every subsequent PDF request.
- [x] HTTP controller test proves rejected inspection never invokes persistence.
- [x] Lint and production build pass.
- [x] Full unit regression passes: 28 suites and 143 tests.
- [x] No dependencies or lockfile entries changed; the zero-vulnerability production
      audit result remains current.

## Increment 11 - Receipt retention boundary

Implemented:

- Operational transaction receipt queries exclude rows whose `archived_at` is set,
  preventing archived evidence from leaking back into active application views.
- Future archive jobs can select only active receipts older than one full PostgreSQL
  calendar year from a bound reference timestamp.
- Eligibility batches are deterministically ordered and hard-limited to 1-500 rows.
- Invalid timestamps and unbounded batch requests fail before any database query.
- No Phase 3 code can mark or delete archive-eligible evidence. Encrypted packaging,
  integrity verification, archive marking and source deletion remain a Phase 9
  atomic workflow as required by the architecture.

Validation evidence:

- [x] Retention DAO suite passes: 1 suite and 3 tests.
- [x] Archived evidence is absent from operational receipt lists.
- [x] One-year eligibility uses parameterized values and excludes already archived
  rows.
- [x] Lint and production build pass.
- [x] Full unit regression passes: 29 suites and 146 tests.
- [x] No dependency or lockfile changes.
