# Backend Test Implementation Checklist

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## Test foundation

- [x] Select/configure Jest/ts-jest unit runner, coverage and integration test commands.
- [x] Start real PostgreSQL and Redis locally; PostgreSQL is used by automated
      integration tests and Redis readiness was validated in Phase 1.
- [ ] Provide fake S3 and a controllable Verify.ET simulator.
- [x] Seed all roles, two businesses, multiple branches and supported banks for
      Phase 2 integration coverage.
- [ ] Make clock, IDs, queue delivery and provider outcomes deterministic.
- [x] Run the foundation migration from a reset, dedicated `_test` PostgreSQL database.

## Unit tests

- [ ] Bank adapter payloads for CBE, BOA, Telebirr, M-Pesa, CBE Birr, Dashen, Awash, Siinqee, Kaafi e-birr and unsupported Zemen.
- [ ] Exact amount, date/time tolerance, receiver and status matching.
- [ ] Verification and subscription state transition guards.
- [ ] Customer and subscription credit rules. FIFO deduction, idempotent grants,
      exactly-once expiry and no retry deduction pass; deferred subscription charging
      remains.
- [x] Zero-credit deferred deduction and all three final balances: 9,999, 19,999 and
      29,999, with exact replay and immutable settlement evidence.
- [x] Same-day duplicate and later-day suspected-fraud classification.
- [x] Three-attempt purchase lock and recovery-code unit decisions.
- [x] Recovery-code database integration: issue, intended-Owner redemption,
      expiry/revocation, replay rejection and atomic purchase unlock.
- [x] Ledger balance formula and implemented entry effects, including verified
      payments, Manual Deposit, withdrawal and compensating reversal.
- [x] Reconciliation categorized totals, Cashier MATCHED/DISCREPANCY states,
      exact-branch Manager APPROVED/RETURNED decisions, replay safety and immutable
      replacement/supersession history.
- [x] Staff dependency/removal rules and historical visibility.
- [x] Account encryption, masking and suffix derivation.
- [ ] Account/log redaction scan across the complete application log surface.

## Database/integration tests

- [x] Cross-business and cross-branch repository isolation for Phase 2 modules.
- [x] Unique active settlement account per bank/branch.
- [ ] Unique provider request, webhook delivery and confirmation keys.
- [ ] One active Waiter device session.
- [x] Posted ledger and financial source entries cannot be changed/deleted by
      application paths.
- [x] Concurrent identical verification posts balance once. Two distinct queued
      attempts are raced against real PostgreSQL; one posts and one replays the same
      confirmation and ledger result.
- [ ] Concurrent financial posting preserves calculated balance.
- [ ] Ordinary credits cannot become negative.
- [x] Initial verification atomically decrements one branch wallet and one eligible
      FIFO lot; rechecks reuse its immutable canonical credit event.
- [x] At most one unresolved deferred deduction per purchase, enforced by PostgreSQL.
- [ ] Outage/retry jobs persist and resume without extra credit.
- [ ] Upload type/size validation, malware result and signed object access.

## Verify.ET contract and failure tests

- [ ] Request/response fixtures for every supported bank.
- [ ] 202 queued stores request and completes by polling/webhook.
- [ ] Pending remains yellow and automatic recheck consumes no extra credit.
- [x] 401 stops provider submission, pauses the job and raises an idempotent critical
      operational alert without failing the customer transaction.
- [x] Platform Super Admin can list and acknowledge sanitized provider incidents;
      acknowledgement and platform-admin audit identity commit together.
- [ ] 402 maps to provider-unavailable/credits-exhausted behavior.
- [ ] 403 does not blind-retry; 409 detects changed idempotent payload.
- [ ] 422 returns sanitized validation; 429 honors Retry-After.
- [ ] 503 follows returned status URL or safely retries.
- [ ] Webhook signature, timestamp/payload limits and delivery-ID deduplication.
- [ ] Duplicate webhook is acknowledged without double posting.

## Critical end-to-end acceptance

- [ ] Waiter success consumes one branch credit, verifies transaction, increases ledger once and emits push.
- [ ] Duplicate customer payment never increases balance twice.
- [x] Cashier Manual Deposit posts `MANUAL_DEPOSIT`, increases balance, calls no provider and consumes no credit.
- [x] Owner removes Waiter; sessions/devices revoke, login blocks through user status,
      and historical identity remains.
- [ ] Starter purchase with available credits consumes one existing credit then grants 10,000.
- [x] Starter purchase at zero credits grants 10,000, settles deferred one and leaves 9,999.
- [ ] Subscription amount mismatch activates nothing and grants no credits.
- [x] Same-day subscription proof reuse is duplicate with no grant.
- [x] Later-day reuse records immutable fraud evidence and increments the counter.
- [x] Later-day reuse notifies Super Admin through a durable platform alert.
- [x] Reconciliation expected balance includes Manual Deposits separately; Manager
      approve/return and returned-draft replacement pass end to end.
- [ ] ID/filter/export attacks expose no cross-business data.

## Phase 8 notification acceptance

- [x] Transaction pending/final events and Waiter device-session events are isolated
      to the affected user.
- [x] Credit, manual-deposit, withdrawal, correction and reconciliation events enforce
      active role, business and branch work scope.
- [x] Reconciliation decisions return to the immutable submitting Cashier.
- [x] Fraud and sanitized provider-incident events are isolated to active Platform
      Super Admins.
- [x] Recipient channel preferences suppress opted-out delivery without changing the
      underlying financial operation.
- [x] Unique idempotency keys prevent duplicate visible notifications.
- [x] Delivery claims retry retryable failures with bounded backoff and terminate after
      retry exhaustion.
- [x] Firebase HTTP v1 contract validates OAuth, bearer authentication, request shape
      and retryable error mapping; live delivery stays fail-closed without credentials.
- [x] Device tokens are encrypted at rest and excluded from responses and errors.
- [x] Notification titles/messages exclude account, amount, recipient and free-text
      financial details.
- [x] All 426 unit tests and all 23 PostgreSQL V2 integration tests pass with Phase 8
      migrations 038-041 included in clean test setup.

## Security, load and operations

- [x] Report summaries reconcile to scoped PostgreSQL sources and keep Manual Deposit
      separate from verified payments.
- [x] Export requests cannot broaden selected business/branch context, are isolated to
      the requester and expose no private storage key.
- [x] Export worker lease, retry, checksum, CSV injection, expiry and download-history
      unit/integration checks pass.
- [ ] Production-sized report/export load thresholds are exercised.

## Phase 9 audit acceptance

- [x] PostgreSQL rejects update and delete against immutable `audit_logs` records.
- [x] Business audit queries enforce membership and selected Manager branch scope;
      query parameters cannot broaden tenant or branch access.
- [x] Platform audit queries require the isolated Platform Super Admin identity.
- [x] Audit writes persist correlation, actor, session, scope, result and bounded
      before/after metadata.
- [x] Sensitive metadata keys, bearer credentials and JWT-shaped values are redacted.
- [x] Audit filters are validated and pagination/range limits are bounded.
- [x] 94 unit suites / 454 tests and 27 PostgreSQL V2 integration tests pass for
      Audit increment 1 with migration 045 included in clean test setup.
- [ ] Audit coverage matrix has no missing sensitive action.
  - [x] Implemented authenticated transaction, proof, report-export,
        notification-preference and notification-device gaps are covered atomically.
  - [x] PostgreSQL integration verifies all seven Increment 2 action types.
  - [ ] Background provider/report system lifecycle gaps are covered.

- [ ] RBAC matrix and IDOR tests for every query/mutation/export.
- [ ] Session refresh rotation, revocation and replaced-device behavior.
- [ ] Secret/account/password/raw-payload leakage scan across logs and errors.
- [ ] Malicious PDF/image, MIME confusion, oversized file and signed-URL tests.
- [ ] Verification burst, webhook burst, pending queue and report export load tests.
- [ ] Queue failure/dead-letter/replay and provider outage tests.
- [ ] Encrypted backup restoration and archive retrieval test.
- [ ] Dependency, secret, static-analysis and vulnerability scans pass.
- [ ] Production monitoring alerts and incident runbooks are exercised.
