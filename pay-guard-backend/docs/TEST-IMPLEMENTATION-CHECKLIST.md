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
- [x] Account/log redaction scan across the complete application log surface. Static
      source rules reject raw errors and request headers/body/URL/query in logs; unit,
      HTTP integration and container-startup exercises inject sensitive markers.

## Database/integration tests

- [x] Cross-business and cross-branch repository isolation for Phase 2 modules.
- [x] Unique active settlement account per bank/branch.
- [ ] Unique provider request, webhook delivery and confirmation keys.
- [x] One active Waiter device session, including serialized concurrent enforcement,
      automatic second-device invalidation and audited replacement.
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
- [x] Production-sized report/export load thresholds are exercised with exact
      financial/operational reconciliation and a rollback-only `_test` database guard.

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
- [x] Audit coverage matrix has no missing sensitive action in implemented surfaces.
  - [x] Implemented authenticated transaction, proof, report-export,
        notification-preference and notification-device gaps are covered atomically.
  - [x] PostgreSQL integration verifies all seven Increment 2 action types.
  - [x] Background report export ready/retry/failure/expiry events are audited.
  - [x] Background provider request, outcome, retry, pause and signed-webhook
        lifecycle events are audited atomically without raw provider payloads.

## Phase 9 archive acceptance

- [x] One-year receipt eligibility and active-query exclusion are enforced in SQL.
- [x] Source and archived package integrity are verified before active removal.
- [x] Archive packages use authenticated application encryption and protected storage.
- [x] Source deletion is post-commit, retryable and independently auditable.
- [x] Retrieval requires Platform Super Admin identity, reason and fresh integrity
      verification, and writes immutable retrieval history/audit evidence.
- [x] Unit tests cover tamper rejection, corruption compensation, authorization and
      deletion failure recovery; migration 046 is included in clean V2 setup.
- [x] Object-storage-backed archive/retrieval exercise passes with a 16 MiB receipt,
      KMS-enabled S3-compatible storage, exact SHA-256/byte recovery, confirmed source
      deletion and complete lifecycle audit evidence.
- [ ] Production managed-key rotation and recovery drill.

- [x] RBAC matrix and IDOR metadata/source-contract tests cover every controller route,
      with exact public allowlisting and actor-bound identifier operations.
- [x] Session refresh rotation, replay rejection, logout revocation and automatic
      Waiter replaced-device behavior pass service and PostgreSQL integration tests.
- [x] Secret/account/password/raw-payload leakage scan across application logs and HTTP
      errors, with regression tests and a repeatable production-source scan.
- [x] Malicious PDF/image, active-PDF, MIME confusion, oversized file and private
      object-access tests pass, with a repeatable signed-URL/storage-key exposure scan.
- [x] Verification transition/concurrency, webhook replay burst, pending lease burst and
      250k-ledger/100k-attempt report export load tests pass.
- [x] Queue lease recovery, durable pause/defer (dead-letter equivalent), idempotent
      replay and provider outage/status-policy tests pass; the Verify.ET runner is wired.
- [x] Authenticated encrypted backup restoration and post-restore archive retrieval pass.
- [x] Dependency, tracked-secret, lint/typecheck static-analysis and vulnerability scans pass.
- [ ] Production monitoring alerts and incident runbooks are exercised.
      - [x] Deployable Prometheus rules cover the rate-limit, Verify.ET, report,
            archive and notification conditions using fixed-cardinality signals.
      - [ ] Named primary/secondary people receive and acknowledge every alert in
            production-equivalent infrastructure.

## Phase 10 hardening acceptance

- [x] Redis-backed rate-limit policy, quota, hashed-client-key, HTTP 429 and
      store-failure behavior are covered by unit tests.
- [x] Production configuration cannot disable application rate limiting and proxy
      trust is constrained to an explicit bounded hop count.
- [x] Rate-limit allowed, blocked, store-error and general-route bypass states expose
      Prometheus-compatible signals without raw client addresses.
- [ ] Production-equivalent WAF/ingress and Redis load validate thresholds for
      expected shared-NAT and mobile-client traffic.
      - [x] Repeatable four-replica real-Redis boundary, mobile, shared-NAT and outage
            rehearsal passes; shared-NAT evidence requires a production policy decision.
      - [ ] Approved traffic distribution and ingress/WAF exercise validate final limits.
- [ ] Individual primary/secondary alert owners acknowledge and exercise the
      Redis/rate-limit incident procedure.
- [x] All-reachable-commit repository-history scan rejects real secret material and
      non-fixture full account numbers without printing matched values.
- [x] API and worker container contracts verify distinct entry commands, role-correct
      health behavior, unprivileged execution, revision labels, runtime cleanup and
      migration assets; CI scans and emits SBOM/provenance for both targets.
- [x] Independent API/worker production startup rehearsal verifies liveness or stable
      worker bootstrap, invalid-configuration rejection, startup-log secret-marker
      absence and ownership-scoped container cleanup.
