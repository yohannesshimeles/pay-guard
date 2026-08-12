# Phase 3 Verifications Validation

Date: 2026-08-06  
Status: Increments 1-18 implemented

## Increment 1 - Canonical state and atomic transition boundary

Implemented:

- Central enums model every V2 customer-transaction and verification-attempt result
  value defined by the database.
- The state machine explicitly permits processing, provider-pending, credit-waiting
  and branch-paused recovery paths.
- `VERIFIED`, `FAILED` and `DUPLICATE` are immutable final states.
- Provider-derived `PENDING`, `VERIFIED` and `DUPLICATE` outcomes accept only the
  internal `VERIFYET` or `SYSTEM` authority. There is no user-controlled authority
  capable of approving provider-pending funds.
- A row lock serializes each transition. The current-status update and immutable
  status-history insert execute in one database transaction.
- Updates include the prior status in their predicate, protecting against stale
  state even inside the locked transaction.
- Only sanitized uppercase reason codes are persisted; raw provider failures are
  rejected at the boundary.
- Migration `006_v2_verification_transition_source.sql` records `SYSTEM`, `VERIFYET`
  or `CREDIT_POLICY` on every history entry.

Validation evidence:

- [x] Focused state, entity and DAO validation passes: 3 suites and 18 tests.
- [x] Full unit regression passes: 40 suites and 222 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests,
      including a real locked transition and history assertion.
- [x] Lint and production build pass.
- [x] Migration `006` applied to the local `payguard_v2` database.
- [x] No dependency or lockfile changes.

## Increment 2 - Branch credit eligibility and exactly-once debit

Implemented:

- An additive branch wallet is now the branch-specific source of truth required by
  the architecture; the existing business wallet remains available for future
  aggregate reporting and migration work.
- Wallet balances enforce non-negative safe integers and the invariant
  `purchased = used + expired + available` in both code and PostgreSQL.
- Eligibility locks the customer transaction, business and branch before making a
  decision. Only active businesses and active branches can proceed.
- Initial ordinary verification atomically decrements available credits, increments
  used credits and inserts one immutable `VERIFICATION` credit event.
- A unique event key and related-record/movement index make initial debit replay
  idempotent under concurrency.
- Zero credits returns `WAITING_CREDITS` without permitting a negative balance.
- A pending `RECHECK` must reference an existing initial credit event and never
  updates the wallet or inserts another debit.
- `REPEAT` and `SUBSCRIPTION` charging remain fail-closed until their separate final
  policies are approved.
- Migration `007_v2_branch_credit_wallets.sql` adds the branch wallet and branch/event
  identity to immutable credit history.

Validation evidence:

- [x] Focused wallet and eligibility validation passes: 2 suites and 10 tests.
- [x] Full unit regression passes: 42 suites and 232 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. The
      real database test proves balance `2 -> 1`, one credit event, and no second debit
      for the pending recheck.
- [x] Lint and production build pass.
- [x] Migration `007` applied to the local `payguard_v2` database.
- [x] No dependency or lockfile changes.

## Increment 3 - Transactional attempt preparation and idempotency

Implemented:

- Migration `008_v2_verification_attempt_idempotency.sql` adds a required globally
  unique attempt key and safely backfills any pre-existing attempt rows.
- Each queued attempt is durably bound to its customer transaction, business, branch,
  attempt type and initial credit transaction.
- Reusing an attempt key is accepted only for the exact same request identity. A key
  replayed for another scope, type or credit event fails closed.
- Credit eligibility, attempt reservation and blocked/resume state transitions share
  one PostgreSQL transaction and transaction-row lock.
- An initial request can resume from `WAITING_CREDITS` or `PAUSED_BRANCH`; a pending
  recheck returns to `PROCESSING` and references its queued attempt in status history.
- Replaying a prepared request bypasses credit resolution and status mutation.
- Zero-credit and inactive-branch decisions persist their canonical blocked state and
  do not create a provider attempt.
- No undocumented Verify.ET transport, endpoint or response schema is enabled.

Validation evidence:

- [x] Focused orchestration, attempt, credit and transition validation passes: 5
      suites and 21 tests.
- [x] Full unit regression passes: 44 suites and 240 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. The
      real database scenario proves exact initial replay, balance `2 -> 1`, one credit
      event, and two queued attempts bound to that event for initial and recheck work.
- [x] Lint and production build pass.
- [x] Migration `008` applied to the local `payguard_v2` database.
- [x] No dependency or lockfile changes.

## Increment 4 - Durable pending-recheck scheduling and worker claims

Implemented:

- Numbered rechecks are limited to `1..3` and can be scheduled only while the
  customer transaction is `PENDING` under a transaction-row lock.
- The `(transaction_id, recheck_number)` database key makes scheduling idempotent;
  reusing a number with a different timestamp fails closed.
- Due work is claimed with PostgreSQL `FOR UPDATE SKIP LOCKED`, so concurrent workers
  cannot claim the same row.
- Claims carry a random token, worker identity and bounded 5-to-300-second lease.
  Expired claims are reclaimable, live leases are renewable, and stale tokens cannot
  complete, defer or pause work.
- Technical deferral persists a sanitized error code and new explicit schedule; no
  retry interval was invented without an approved provider policy.
- The coordinator derives a deterministic attempt key from transaction and recheck
  number, prepares the no-charge `RECHECK`, and completes the claimed job with the
  resulting attempt identity.
- A worker crash after attempt preparation is safe: lease recovery replays the exact
  attempt key and cannot consume another credit.
- Inactive branches persist a paused job and clear lease ownership. The provider
  transport and result schema remain fail-closed.
- Migration `009_v2_pending_recheck_claims.sql` adds claim, expiry, completion and
  sanitized failure metadata with database consistency constraints.

Validation evidence:

- [x] Focused entity, claim DAO and coordinator validation passes: 3 suites and 12
      tests.
- [x] Full unit regression passes: 47 suites and 252 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. The real
      database scenario now proves schedule, lease claim, no-charge recheck preparation,
      completed-job binding and cleared claim ownership.
- [x] Lint and production build pass.
- [x] Migrations `001` through `009` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 5 - Atomic provider outcome persistence

Implemented:

- A normalized internal boundary accepts only sanitized provider request identity,
  status, timestamps and error codes; it persists no raw provider response.
- Attempt outcome update, canonical transaction transition, immutable status history
  and the next pending-recheck schedule commit in one PostgreSQL transaction.
- Exact provider-outcome replay is idempotent and performs no second transition or
  schedule. A changed result, request identity, status, timing or error code fails
  closed as an outcome conflict.
- `PENDING` requires an explicit next schedule while rechecks remain. After completed
  recheck 3, PayGuard preserves `PENDING`, reports the limit, and invents no terminal
  financial result.
- Sanitized semantic `FAILED` is terminal and creates no recheck.
- Provider-reported `VERIFIED` and `DUPLICATE` remain fail-closed until reference,
  exact amount, receiver and time-window matching plus immutable ledger posting are
  implemented atomically.
- Provider request identity is unique, and PostgreSQL now requires complete timing
  metadata for every finalized attempt.
- Migration `010_v2_verification_attempt_outcomes.sql` adds provider-request
  uniqueness and finalized-outcome consistency constraints.

Validation evidence:

- [x] Focused attempt entity/DAO and outcome validation covers 3 suites and 14 tests.
- [x] Full unit regression passes: 48 suites and 259 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. It
      proves atomic initial `PENDING`, exact outcome replay, claimed recheck finalization,
      no second credit, and durable scheduling of recheck 2.
- [x] Lint and production build pass.
- [x] Migrations `001` through `010` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 6 - Verified-payment matching and atomic ledger posting

Implemented:

- Branch verification settings now require an explicit IANA timezone and bounded
  time tolerance; no financial matching default is inferred.
- A provider-verified payment must match the supported bank, case-sensitive
  reference, exact two-decimal amount, active receiver-account suffix and configured
  branch-local time window before funds can be posted.
- A mismatch persists only a sanitized failure code, transitions the transaction to
  `FAILED`, and creates no confirmation, balance update or ledger entry.
- A matched result creates the confirmation, increments the settlement-account
  calculated balance, writes an immutable `VERIFIED_DEPOSIT` ledger entry, links the
  customer transaction and transitions it to `VERIFIED` in one database transaction.
- The bank/reference/receiver confirmation key is unique. A match already confirmed
  for another transaction is recorded as `DUPLICATE`, points to the original
  transaction and creates no second balance or ledger effect.
- Exact finalized-attempt replay returns the persisted confirmation/ledger result and
  performs no mutation. Duplicate replay is scoped to the exact attempt identity.
- Migration `011_v2_verified_payment_posting.sql` adds explicit branch match settings,
  immutable transaction confirmations and attempt-bound duplicate records.
- The generic outcome service remains unable to promote provider-reported
  `VERIFIED` or `DUPLICATE`; only this match-and-post boundary can do so.

Validation evidence:

- [x] Focused posting validation passes: 1 suite and 5 tests.
- [x] Full unit regression passes: 49 suites and 264 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. The
      real PostgreSQL scenario proves branch-local time matching, one confirmation, one
      balance increase, one ledger entry and mutation-free exact replay.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `011` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 7 - Concurrent verified-posting idempotency

Implemented:

- An existing confirmation for the same customer transaction is now treated as a
  transaction-level financial replay even when it arrives through another queued
  verification attempt.
- The later attempt persists its verified provider outcome but cannot update the
  settlement balance, create another ledger entry or repeat the final transition.
- Replay lookup is bound to the exact attempt for duplicate records while verified
  confirmation and ledger linkage remain transaction-scoped.
- A real PostgreSQL race starts two distinct queued attempts with different provider
  request IDs against the same transaction. Transaction/account row locks serialize
  the financial boundary: one call posts and the other returns the persisted result.

Validation evidence:

- [x] Focused posting validation passes: 1 suite and 6 tests, including the
      separate-attempt financial replay path.
- [x] Full unit regression passes: 49 suites and 265 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. The
      concurrent scenario proves one non-replayed result, one replayed result, one
      confirmation, one ledger entry and one `125.50` balance increase.
- [x] Strict lint and production build pass.
- [x] No schema or dependency change was required; migrations `001` through `011`
      remain applied.

## Increment 8 - Lease-safe internal Verify.ET worker orchestration

Implemented:

- A narrow provider adapter accepts only the canonical bank code, reference, exact
  amount and receiver suffix and returns normalized pending, failed or verified data.
- The production default adapter throws immediately, so no undocumented Verify.ET
  endpoint, authorization header, payload or response contract can be used.
- The worker claims due work, prepares a deterministic no-charge recheck attempt,
  binds that attempt to the still-active lease and loads only the minimum provider
  work-item fields.
- Request reservation, idempotency identity, sent status and hashed normalized
  response history are connected to each dispatch.
- Pending and failed results pass through atomic normalized outcome persistence;
  verified results pass through exact matching and atomic financial posting.
- The worker completes the claimed recheck only after the domain outcome commits.
  Provider exceptions leave the claim incomplete so lease expiry can safely reclaim
  the same deterministic attempt.
- Pending outcome resolution now accepts an attempt bound to a live claimed recheck,
  allowing the next schedule to commit before the current claim is released.

Validation evidence:

- [x] Focused claim/coordinator/worker validation passes: 3 suites and 16 tests.
- [x] Full unit regression passes: 50 suites and 272 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests.
- [x] Strict lint and production build pass.
- [x] No schema or dependency change was required; migrations `001` through `011`
      remain applied.

## Increment 9 - Provider failure recovery and operational alerts

Implemented:

- Known provider failures are handled only through the sanitized
  `VerifyEtProviderError` taxonomy; unknown exceptions remain fail-closed under the
  worker lease and are never converted into a customer financial result.
- Retryable failures use the bounded polling policy with the persisted provider
  request attempt count. The owned claim is deferred to the explicit calculated
  schedule and records only the sanitized error code.
- A failed provider request can return to `SENT`, increments its attempt count and
  clears its prior completion/error markers before another idempotent dispatch.
- Non-retryable failures and exhausted retry plans move the job to the explicit
  `PAUSED_PROVIDER` state instead of incorrectly failing the customer transaction.
- Stopped provider work creates an idempotent global `security_alerts` record with a
  critical severity for authentication failures and high severity for other stopped
  provider failures.
- Alert details contain only the error code, provider request-record ID and customer
  transaction ID. Raw responses, secrets and customer account numbers are excluded.
- Migration `012_v2_verifyet_provider_incidents.sql` adds `PAUSED_PROVIDER` and a
  unique operational alert key.

Validation evidence:

- [x] Focused worker/history/alert/claim validation passes: 4 suites and 25 tests.
- [x] Full unit regression passes: 51 suites and 276 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests from a
      reset schema including migration `012`.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `012` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 10 - Super Admin provider-incident operations

Implemented:

- Authenticated endpoints list, inspect and acknowledge Verify.ET provider incidents
  under `/api/v1/platform/provider-incidents`.
- Both the role and V2 identity type must represent a Platform Super Admin. A
  business identity cannot gain access by supplying a privileged role value.
- Responses expose only severity, sanitized error code, internal provider-request
  record ID, transaction ID, status and acknowledgement timestamps/identity.
- List filters are allow-listed and pagination is bounded to 100 records per request
  and a maximum offset of 10,000.
- Acknowledgement locks the incident. Exact replay is idempotent; a changed actor or
  note is rejected as a conflict.
- Incident acknowledgement and immutable Platform Super Admin audit identity commit
  in the same database transaction.
- Migration `013_v2_verifyet_incident_acknowledgement.sql` adds constrained
  acknowledgement metadata and a provider-incident query index.

Validation evidence:

- [x] Focused incident DAO/service/audit validation passes: 3 suites and 10 tests.
- [x] Full unit regression passes: 53 suites and 284 tests.
- [x] Database-backed V2 regression passes: 1 suite and 8 integration tests. The
      authenticated HTTP scenario proves list, acknowledgement, admin identity and audit
      persistence against a reset schema including migration `013`.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `013` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Add approved Verify.ET request/response fixtures and bind the first real bank
  adapter only after its endpoint, authentication scheme and status semantics are
  confirmed.
- Until those vendor details exist, keep external provider transport disabled.

## Increment 11 - Scoped transaction queries and Waiter own history

Implemented:

- Authenticated list, detail and chronological status-history endpoints under
  `/api/v1/businesses/:businessId/transactions`.
- Business membership, selected branch and Waiter submitter scope are converted to
  mandatory parameterized DAO predicates. Detail/history use not-found responses for
  inaccessible records to prevent cross-scope existence disclosure.
- List filters are allow-listed and bounded: status, branch, bank, date range, limit
  up to 100 and offset up to 10,000. A selected branch cannot be overridden.
- Responses expose masked account data and safe receipt/confirmation/posting
  indicators only. Storage keys, evidence hashes, full accounts, provider request
  IDs and provider response payloads are excluded.
- Migration `014_v2_transaction_query_indexes.sql` adds business/branch and submitter
  indexes for the supported access paths.

Validation evidence:

- [x] Focused transaction DAO/service validation passes: 2 suites and 9 tests.
- [x] Full unit regression passes: 55 suites and 293 tests.
- [x] Database-backed V2 regression passes: 1 suite and 9 tests and proves Waiter
      own-history isolation on migration
      `014`.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `014` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Add transaction creation orchestration after the approved receipt-to-verification
  contract is finalized; retain the provider-independent query boundary meanwhile.

## Increment 12 - Idempotent transaction submission and receipt preparation

Implemented:

- Authenticated branch transaction submission is available at
  `POST /api/v1/businesses/:businessId/branches/:branchId/transactions`.
- The authenticated business, selected branch, user and active work assignment are
  authoritative; client input cannot select another submitter or assignment.
- The database insert requires an active business, branch, membership, role,
  assignment and matching active branch settlement account/bank.
- A client UUID idempotency key is unique per business and submitter. Exact sequential
  and concurrent replays return the original transaction; changed replays return a
  conflict. Only the first insert writes `TRANSACTION_SUBMITTED` history.
- Receipt upload starts initial verification only for one complete QR payload whose
  bank profile supports direct verification. Missing, multiple, partial or unsupported
  QR evidence returns `REVIEW_REQUIRED` and consumes no verification credit.
- Existing malware scanning, protected object storage and failed-persistence cleanup
  remain before verification preparation.
- Migration `015_v2_transaction_submission_idempotency.sql` adds the partial unique
  submission-key index without changing historical rows.

Validation evidence:

- [x] Focused submission DAO/service validation passes: 2 suites and 6 tests.
- [x] Full unit regression passes: 57 suites and 299 tests.
- [x] Strict lint and production build pass.
- [x] Database-backed V2 HTTP submission/replay validation passes as part of the
      10-test integration suite.
- [x] Migration `015` is applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Start Docker Desktop, apply migration `015`, run the V2 integration suite, then add
  explicit receipt-to-transaction field matching before provider dispatch.

## Increment 13 - Receipt-to-transaction matching gate

Implemented:

- Receipt authorization now loads only the stored transaction values required for
  matching: business, branch, submitter, reference, amount, date/time, bank identifier
  and normalized settlement-account suffix.
- A dedicated matcher compares the complete parsed QR payload with the authoritative
  stored transaction before initial verification preparation.
- Bank identifiers are normalized; reference is exact; supplied amount, date, time
  and account suffix must match. Each mismatch returns one allow-listed reason code.
- Mismatched, incomplete, ambiguous, unsupported or missing QR data remains
  `REVIEW_REQUIRED` and never calls verification preparation, so no credit is consumed.
- Raw QR values, full account data and receipt storage metadata remain absent from the
  API response and logs.

Validation evidence:

- [x] Focused matcher/controller/access validation passes: 3 suites and 18 tests.
- [x] Full unit regression passes: 58 suites and 308 tests.
- [x] Strict lint and production build pass.
- [x] Database migration `015` is applied and the V2 integration suite passes all
      10 tests.
- [x] No dependency or lockfile changes.

## Next increment

- Once Docker is available, close the migration/integration gate, then persist a
  sanitized receipt-match decision for operational review and auditability.

## Increment 14 - Immutable receipt-match decision ledger

Implemented:

- Every persisted receipt records one sanitized `MATCHED` or `REVIEW_REQUIRED`
  decision before verification preparation.
- Review reasons are constrained to allow-listed extraction and comparison outcomes;
  no raw QR value, full account, object-storage key or provider payload is stored.
- Decision writes are idempotent by receipt ID. Exact replay is accepted and changed
  replay is rejected.
- Database constraints require matched decisions to have no reason and review
  decisions to have one reason.
- Update and delete triggers make the decision ledger immutable.
- Migration `016_v2_receipt_match_decisions.sql` adds the ledger and its
  transaction/time query index.

Validation evidence:

- [x] Focused DAO/controller validation passes: 2 suites and 9 tests.
- [x] Full unit regression passes: 59 suites and 311 tests.
- [x] Database-backed V2 regression passes: 1 suite and 10 tests against a reset
      schema containing migrations `001` through `016`.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `016` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Expose role-scoped receipt decision history through the existing transaction detail
  boundary and add operational counts for review-required receipts.

## Increment 15 - Role-scoped receipt decisions and review counts

Implemented:

- `GET /api/v1/businesses/:businessId/transactions/:transactionId/receipt-decisions`
  returns chronological sanitized decisions for one visible transaction.
- `GET /api/v1/businesses/:businessId/transactions/receipt-review-summary`
  returns matched/review-required totals and allow-listed reason counts.
- Summary filters support branch and inclusive date bounds. Selected branch scope
  cannot be overridden and inverted date ranges are rejected.
- Business, branch and Waiter submitter predicates are identical to the existing
  transaction list/detail/history boundary. Inaccessible transaction decisions return
  not found to avoid existence disclosure.
- Responses exclude object-storage keys, hashes, raw QR values, account values and
  provider metadata.
- Migration `017_v2_receipt_review_operational_index.sql` adds the decision/reason/time
  index for operational aggregation.

Validation evidence:

- [x] Focused transaction DAO/service validation passes: 2 suites and 13 tests.
- [x] Full unit regression passes: 59 suites and 315 tests.
- [x] Database-backed V2 regression passes: 1 suite and 10 tests. The PostgreSQL
      scenario verifies Waiter-scoped decision history and review counts.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `017` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Add bounded owner/manager operational review queues with receipt-safe metadata and
  explicit acknowledgement/resolution workflow; Waiters remain limited to their own
  transactions.

## Increment 16 - Owner/Manager receipt review workflow

Implemented:

- `GET /api/v1/businesses/:businessId/receipt-review-queue` returns a bounded,
  filterable queue of review-required receipts for Business Owners and Managers.
- `POST /api/v1/businesses/:businessId/receipt-review-queue/:caseId/acknowledge`
  records an explicit acknowledgement and operator note.
- `POST /api/v1/businesses/:businessId/receipt-review-queue/:caseId/resolve`
  records an allow-listed operational resolution and optional note.
- Managers are restricted to their selected branch. Waiters and Platform Super
  Admins cannot use the business review queue, and a selected branch cannot be
  overridden by request input.
- Every `REVIEW_REQUIRED` match decision atomically opens one review case and one
  immutable `OPEN` history entry. Decision replay does not create duplicate cases.
- Lifecycle transitions are row-locked and constrained to
  `OPEN -> ACKNOWLEDGED -> RESOLVED`. Exact transition replays are idempotent;
  conflicting or out-of-order transitions are rejected.
- Acknowledgement and resolution append immutable history and V2 audit records in
  the same database transaction.
- Queue responses contain receipt-safe metadata only. Storage keys, evidence hashes,
  raw QR values, full account values and provider payloads remain excluded.
- The workflow is operational only: acknowledgement and resolution do not change the
  customer transaction status, ledger linkage, balances, credits or settlement data.
- Migration `018_v2_receipt_review_cases.sql` adds constrained review cases,
  immutable lifecycle history and the supported queue indexes.

Validation evidence:

- [x] Focused review DAO validation passes: 1 suite and 3 tests.
- [x] Full unit regression passes: 61 suites and 322 tests.
- [x] Database-backed V2 regression passes: 1 suite and 11 tests. The PostgreSQL
      scenario proves scoped queue access, lifecycle transitions and no mutation of
      transaction status or ledger linkage.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `018` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes; the previously validated production audit
      remains at zero high-severity vulnerabilities.

## Next increment

- Add a role-scoped review-case history endpoint and operational ageing/SLA summary
  so Owners and Managers can audit transitions and prioritize stale open cases.

## Increment 17 - Review-case history and SLA ageing summary

Implemented:

- `GET /api/v1/businesses/:businessId/receipt-review-queue/:caseId/history`
  returns the immutable chronological `OPEN`, `ACKNOWLEDGED` and `RESOLVED`
  lifecycle for one visible review case.
- `GET /api/v1/businesses/:businessId/receipt-review-queue/ageing-summary`
  returns active, open, acknowledged, within-SLA and overdue counts plus the oldest
  active case time and age.
- The SLA threshold is explicit and bounded from 1 to 720 hours, with a default of
  24 hours. Optional reason and branch filters are allow-listed.
- Owners remain business-scoped and Managers remain selected-branch scoped. Waiters
  and Platform Super Admins cannot access either endpoint, and inaccessible case
  history returns not found to avoid cross-scope existence disclosure.
- History exposes only lifecycle metadata, bounded operator notes and actor IDs.
  Receipt object keys, hashes, raw QR values, account values and provider payloads
  remain excluded.
- Both endpoints are read-only and have no authority to update customer transaction
  state, ledger linkage, balances, credits or settlement data.
- Existing migration `018_v2_receipt_review_cases.sql` already provides the immutable
  history table and supported indexes, so no migration was required.

Validation evidence:

- [x] Focused review DAO/service validation passes: 2 suites and 11 tests.
- [x] Full unit regression passes: 61 suites and 326 tests.
- [x] Database-backed V2 regression passes: 1 suite and 11 tests. The PostgreSQL
      scenario validates the active SLA count and chronological three-step history
      through authenticated HTTP.
- [x] Strict lint and production build pass.
- [x] Migrations `001` through `018` remain applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Add the remaining provider-independent completion tests: Manager denial of any
  provider-pending approval path, correlation-ID response assertions and the complete
  sanitized verification-outcome response matrix.

## Increment 18 - Sanitized outcomes and provider-pending authority denial

Implemented:

- `GET /api/v1/businesses/:businessId/transactions/:transactionId/verification-outcomes`
  returns chronological normalized attempt outcomes for a visible transaction.
- Responses contain attempt ID, type, number, normalized outcome, bounded timing and
  a generic failure category only. Attempt keys, provider request IDs/statuses,
  credit transaction IDs and raw provider error codes are excluded.
- The endpoint reuses the transaction business, selected-branch and Waiter-own-history
  predicates. Out-of-scope transactions return not found to avoid existence disclosure.
- Successful and error responses echo the accepted correlation ID in both the
  `x-correlation-id` header and response envelope.
- The verification-outcome API is GET-only. There is no Manager approval, override or
  manual provider-outcome operation in the generated OpenAPI contract.
- An authenticated Manager write attempt receives not found and leaves a provider-
  pending transaction status and null ledger linkage unchanged.
- No migration is required because the endpoint reads the existing immutable
  verification-attempt records through the established transaction scope.

Validation evidence:

- [x] Focused transaction DAO/service validation passes: 2 suites and 15 tests.
- [x] Full unit regression passes: 61 suites and 328 tests.
- [x] Database-backed V2 regression passes: 1 suite and 12 tests. The PostgreSQL
      scenario validates outcome sanitization, correlation propagation, the GET-only
      OpenAPI contract and Manager write denial without financial mutation.
- [x] Source and test strict-lint gates pass separately with zero warnings.
- [x] Production build passes.
- [x] Migrations `001` through `018` remain applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Complete the provider-independent verification-outcome E2E matrix for failed,
  duplicate, mismatch, provider-unavailable and credit-exhausted results. Real
  transport, webhook and bank-fixture cases remain gated on approved vendor inputs.
