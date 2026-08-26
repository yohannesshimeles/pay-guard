# Backend Module Implementation Checklist

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

Use this checklist during implementation. A module is complete only when its migration,
API, authorization, audit, observability and tests are complete.

## Phase 1 - Platform foundation

### Application bootstrap and configuration

Implementation:

- [x] Replace the JavaScript/Express bootstrap with strict TypeScript and NestJS.
- [x] Create API and worker entry points from the same module packages.
- [x] Validate environment configuration at startup.
- [x] Configure local PostgreSQL, Redis and S3-compatible storage.
- [x] Add formatting, linting, migration, unit, integration and build commands.
- [x] Add correlation IDs and consistent success/message/data/error envelopes.
- [x] Generate API documentation from controllers/contracts.
etf jr i fr kgjmm , vy cj ,nm,kv  
Expected:
t lnju n,3n,k n k  , n
- [x] API and worker start independently with validated configuration. The guarded
      Phase 10 container rehearsal verifies both positive boot paths, production
      configuration rejection and configured-secret absence from startup logs.
- [x] Missing secrets/configuration fail validation without printing secret values.
- [x] Local equivalents of ,vi m,fsdov , nh n,  kkCI lint, typecheck, migration, unit, integration and build
      gates pass. Hosted CI execution remains a repository/remote concern.
 ,  ,knvk n,r   y n  ,mne
### Observability and operational foundationirex  , d,nuter
 fn m
Implementation:

- [x] Add structured redacted logging d,and request correlation. Every HTTP route,
      including unprefixed probes, receives a validated correlation ID; completion
      logs contain only method, route template, status, outcome and bounded duration.
- [x] Add OpenTelemetry traces and Prometheus-compatible metrics.
- [x] Add API liveness/readiness and dependency health checks.
- [ ] Measure queue depth/age, webhook delivery, provider latency and API failures.

Expected:

- [ ] A verification can be traced from client request through worker/provider callback.
- [x] Logs never contain API keys, passwords, full account numbers or sensitive raw
      payloads. Sanitizer/error tests, startup marker scanus, request-logger tests and
      a static complete-source leakage gate enforce the implemented log boundaries.
- [x] Health endpoints distinguish process li  l veness from database/Redis/storage readiness.j

## Phase 1 - Authentication and Sessions modulee

Implementation:
bif,m
- [x] Create users, roles, permissions, user roles, sessions, devices and reset-token migrations.
- [ ] Implement login, refresh, logout, password reset andn `GET /auth/me`.
- [x] Add short-lived access tokens and rotated refresh tokens.
- [x] Implement server-side RBAC plus business/branch context.
- [x] Enforce one active Waiter device and second-device invalidation.
- [x] Revoke sessions when a user is removed, suspended or explicitly logged out.
- [ ] Audit login, reset, role, device and revocation events. Login/logout and automatic
      Waiter device replacement are implemented; reset/role and explicit device-command
      audit completion depends on their future endpoints.

Expected:

- [ ] Every request has a verified principal, role and allowed scope.
- [ ] A second Waiter login invalidates the first session.
- [ ] Removed users cannot refresh or log in.
- [ ] Unauthorized resources are not disclosed through status or error detail.

Completion:

- [ ] Role/action/scope matrix tests pass.
- [ ] Refresh replay and revocation integration tests pass.
- [x] Authentication secrets are redacted from application logs and HTTP responses;
      raw error-message sinks are rejected by the Phase 9 leakage scan.

## Phase 2 - Businesses module

Implementation:

- [x] Create businesses, business owners and business status-history migrations.
- [x] Implement self-registration and Super Admin application review.
- [x] Implement activate, suspend and status history.
- [x] Scope Owner queries to linked businesses only.
- [x] Audit creation, approval, activation and suspension.

Expected:

- [x] Owner can manage multiple explicitly selected businesses.
- [x] Only Super Admin can see cross-business information.
- [x] Suspended businesses reject new branch, staff and settlement-account setup.

Completion:

- [x] Two-business isolation tests pass for Phase 2 reads and mutations.
- [ ] Export isolation is validated with the Phase 9 exports module.

## Phase 2 - Branches module

Implementation:

- [x] Create branches, assignments and branch-settings migrations.
- [x] Implement branch create/read/update and business linkage.
- [x] Enforce exactly one branch assignment for Manager, Cashier and Waiter.
- [x] Expose branch configuration required by credits, accounts and reports.
- [x] Audit branch and assignment changes.

Expected:

- [x] Phase 2 branch-specific users and accounts never cross branches.
- [x] Owner must send explicit business and branch context.

Completion:

- [x] Cross-business/cross-branch ID tests pass.
- [x] Invalid multi-branch staff assignment is rejected.

## Phase 2 - Users module

Implementation:

- [x] Implement Manager, Cashier and Waiter creation with temporary credentials.
- [x] Model Active, Inactive and Removed states.
- [x] Implement staff removal with mandatory reason.
- [x] Check final-required-Manager dependency before removal.
- [x] Revoke access, refresh tokens and active device sessions atomically.
- [x] Preserve dependent history through soft removal (no user deletion).
- [x] Keep Removed users out of normal lists but available to authorized history/audit.

Expected:

- [x] Owner can safely remove branch staff without deleting historical identity.
- [x] Removed user access ends immediately.
- [x] Audit records Owner, reason, time, branch and previous state.

Completion:

- [x] Removal success, dependency rejection, session/device revocation and history tests pass.

## Phase 2 - Banks and Settlement Accounts module

Implementation:

- [x] Create banks, branch settlement accounts and Platform subscription accounts.
- [x] Encrypt full account/wallet values and derive safe mask/suffix.
- [x] Enforce one active account for each branch/bank.
- [x] Implement enabled-bank and account lifecycle rules.
- [x] Implement Super Admin add/activate/deactivate/rotate/default/accepted-plan actions.
- [x] Preserve original Platform account linkage when Phase 7 creates subscription payments.

Expected:

- [x] Normal APIs return masked data only.
- [x] Phase 7 purchase selection matches the detected payment bank.
- [x] Account lifecycle changes do not rewrite prior account rows.

Completion:

- [x] Encryption, masking, uniqueness and authorization tests pass.
- [x] Historical subscription-payment linkage test passes in Phase 7.

## Phase 3 - QR Processing module

Increment 1 validation boundary:

- [x] Add reusable JPG/JPEG, PNG and PDF filename, MIME, size and magic-byte
      validation before decoding or storage.
- [x] Calculate a SHA-256 evidence hash without logging or returning raw content.
- [x] Model no-QR, single-QR and multiple-QR outcomes without silently selecting
      one of multiple candidates.
- [x] Add fail-closed malware and QR decoder ports plus secure intake orchestration.
- [x] Implement the ClamAV `INSTREAM` adapter with timeout, disconnect and infected-
      response tests.
- [x] Add server-generated private storage keys, receipt DAO persistence and object
      deletion compensation after database failure.
- [x] Wire the validator to authenticated multipart intake after the malware-scanner
      and QR-decoder adapters are selected.

Implementation:

- [x] Accept JPG, JPEG, PNG and PDF within configured limits.
- [x] Validate content/MIME, scan malware and store evidence in protected object storage.
- [x] Detect no QR, one QR, multiple QR and unsupported proof.
- [x] Decode bank, reference, amount, date/time and receipt URL/token where supported.
- [x] Process uploaded camera JPG/JPEG/PNG proof through the same secure intake pipeline.
- [ ] Apply the approved multiple-QR selection/rejection policy when confirmed.

Expected:

- [x] Clients receive sanitized extraction states without protected raw evidence.
- [x] Malformed or hostile documents do not execute or reach storage/provider adapters.
- [x] Evidence retention follows the active/archive policy: operational queries
      exclude archived receipts, one-year eligibility is enforced, and Phase 9
      provides encrypted transfer, integrity verification and verified deletion.

Completion:

- [ ] Approved bank receipt corpus and malicious-file tests pass.

## Phase 3 - Verify.ET module

Implementation:

- [ ] Implement provider authentication and managed-secret loading. Managed-secret,
      HTTPS-origin and disabled-by-default configuration are complete; the authorization
      header/scheme remains blocked on the final vendor contract.
- [ ] Implement submit, status, events, history and test-webhook operations.
- [ ] Implement CBE, BOA, Telebirr, M-Pesa, CBE Birr, Dashen, Awash, Siinqee and Kaafi adapters.
- [ ] Mark Zemen direct verification unsupported.
- [x] Implement request idempotency and provider request/response history. Durable
      request reservation, exact replay checks, lifecycle tracking and sanitized hashed
      response history are complete; migration `004` must be applied per environment.
- [ ] Implement signed webhook validation and delivery-ID deduplication. Durable
      delivery-ID deduplication, raw-body bounds and fail-closed verifier infrastructure
      are complete; the actual signature algorithm and HTTP route remain blocked on the
      final vendor contract.
- [ ] Implement polling, retry, `Retry-After` and returned status-URL handling.
      Bounded attempt/backoff policy, deterministic jitter, `Retry-After` precedence and
      same-origin status-URL validation are complete. A lease-safe internal worker now
      dispatches through a normalized, fail-closed adapter and persists outcomes before
      releasing claims; real transport remains blocked on final provider schemas and
      status values.
- [x] Map 401/402/403/409/422/429/503 exactly to the PDF policy.

Expected:

- [ ] Only PayGuard backend communicates with Verify.ET.
- [ ] Automatic retry/poll/webhook never creates a new credit deduction.
- [x] Provider failures are sanitized and visible to Super Admin operations.
      Increment 10 provides role- and identity-restricted list/detail/acknowledgement
      endpoints with bounded filters, idempotent r mu ow locking and atomic admin audit.

Completion:

- [ ] Provider contract fixtures and every erbror-path test pass.
- [ ] Duplicate webhook cannot repeat a financial/credit effect.

## Phase 3 - Verifications module

Implementation:

- [x] Implement the canonical processing and result state machine. Immutable final
      states, internal transition authorities, row locking and atomic status history are
      complete in Verifications increment 1.
- [x] Resolve branch credit eligibility ben k ,vbfore ordinary verification. Branch wallet
      locking, exactly-once initial debit, zero-credit blocking and no-charge rechecks are
      complete in Verifications increment 2.
- [x] Create idempotent queued attempts and bind them to the initial credit event.
      Eligibility, attempt reservation and blocked/resume transitions now commit in one
      database transaction; exact key replay has no repeated credit or state effect.
- [x] Match reference, exact amount, configured time tolerance, receiver and status.
      Increment 6 requires an active settlement account and explicit branch timezone and
      tolerance before a provider-verified result can post funds.
- [ ] Implement pending queue and automatic rechecks. Durable numbered schedules,
      concurrent `SKIP LOCKED` claims, bounded renewable leases, crash-safe deterministic
      attempt preparation and completion are implemented in increment 4. The actual
      provider worker loop remains gated on the final provider contract.
- [x] Persist normalized provider outcomes atomically with attempt and transaction
      history. Pending schedules the next explicit recheck; verified and duplicate
      results pass through the match-and-post transaction boundary.
- [x] Implement bank/reference/receiver confirmation uniqueness.
- [x] Record duplicates without a second balance increase.
- [x] Return role-appropriate sanitized responses and correlation IDs. Transaction-
      scoped verification outcomes expose normalized results and timing only; provider
      identifiers, status values, attempt keys, credit IDs and raw errors are excluded.

Expected:

- [x] Initial verification consumes exactly one credit under the approved policy.
- [x] Queued/pending retry paths consume none at the eligibility boundary.
- [x] Manager has no API capable of approving provider-pending payment. The outcome
      route is GET-only in OpenAPI, and authenticated write-denial tests prove pending
      status and ledger linkage remain unchanged.

Completion:

- [ ] Success, queued, pending, failed, duplicate, amount/account mismatch, bank/provider
      unavailable and credits-exhausted E2E tests pass.

## Phase 3 - Transactions module

Implementation:

- [x] Create operational transactions, status history, receipts and confirmations.
- [x] Link every record to one business and branch.
- [x] Preserve provider request/result history and safe evidence link.
- [x] Expose role-scoped transaction queries and own-history Waiter queries.
- [x] Expose Owner/Manager receipt-review queues, immutable lifecycle history and
      bounded SLA ageing summaries without granting financial approval authority.

Expected:

- [x] Transaction history explains every state transition through sanitized,
      chronological status-history responses.
- [x] Waiter cannot query another Waiter's transaction; business, branch and
      submitter predicates are enforced by the DAO boundary.

Completion:

- [x] Scope and history tests pass. Retention remains delegated to the protected
      receipt archive lifecycle and no storage key, hash or provider payload is
      exposed by transaction query APIs.

## Phase 5 - Ledger module

Implementation:

- [x] Create ledger accounts/entries and all PDF-defined financial entry types. V2
      settlement accounts are the operational ledger accounts; migration `019` adds
      the missing linked `REVERSAL` type without rewriting historical entries.
- [x] Implement calculated balance formula. Central posting applies credit/debit
      direction atomically and stores the resulting running balance.
- [x] Post entries with database transaction and row-level protection.
- [x] Make posted entries immutable to application update/delete paths.
- [x] Implement linked compensating corrections/reversals with explicit immutable
      Manager approval records.
- [x] Store business, branch, account, effective time, creator, reason and audit ID.
- [x] Route verified customer payments through the central ledger boundary and expose
      business/branch-scoped ledger list, detail and read-only projected balances.

Expected:

- [x] Verified Payment and centralized Manual Deposit entries increase once.
- [x] Withdrawal decreases correctly.
- [x] Corrections/reversal compensate without changing original records.

Completion:

- [x] Foundation concurrency, immutability and balance-invariant tests pass. API-level
      Manual Deposit, withdrawal and correction policy tests remain module gates.

## Phase 5 - Manual Deposits module

Implementation:

- [x] Implement create/list/detail for an active assigned-branch account.
- [x] Validate positive ETB amount, precision, description, date/time and optional attachment.
- [x] Reject future date unless configuration permits it. Current policy rejects it.
- [x] Return current/projected balance before final posting and require exact confirmation.
- [x] Post `MANUAL_DEPOSIT` and audit in one database transaction.
- [ ] Expose Manager flag and linked correction operations.

Expected:

- [x] Manual Deposit increases calculated balance.
- [x] It makes no Verify.ET request and consumes no verification credit.
- [ ] Original cannot be edited/deleted and reports show it separately. Database
      immutability is validated; reporting remains pending.

Completion:

- [ ] Create, concurrency, history, correction and no-provider/no-credit tests pass.
      Create, exact replay, history safety and no-provider/no-credit gates pass;
      Manager flag/correction and a dedicated multi-connection race remain pending.

## Phase 5 - Financial Operations module

Implementation:

- [x] Implement Cashier withdrawal.
- [x] Implement Manager correction and reversal approval.
- [x] Calculate/return balance impact before confirmation for Cashier withdrawals.
- [x] Require reason/evidence where defined and audit every action. Corrections accept
      only a matching optional reconciliation evidence link; every approval requires
      a meaningful reason.

Expected:

- [x] Every implemented financial operation produces an immutable ledger record.
- [x] Manager review follows branch scope.

Completion:

- [x] Entry-effect, permissions, idempotency and insufficient-balance policy tests
      pass for withdrawals, corrections and compensating reversals.

## Phase 6 - Reconciliation module

Implementation:

- [x] Calculate opening, verified, Manual Deposit, withdrawal, correction and signed
      reversal totals within schedule-defined close-to-close periods.
- [x] Accept Cashier-confirmed balance and calculate difference.
- [x] Implement DRAFT, SUBMITTED, MATCHED, DISCREPANCY, APPROVED and RETURNED,
      including deterministic immutable transition history.
- [x] Implement exact-branch Manager approve/return decision queues, mandatory reason,
      replay protection, audit and returned-snapshot supersession.

Expected:

- [x] Manual Deposit appears as a separate category.
- [x] Expected balance exactly reconciles with ledger categories.

Completion:

- [x] Match, discrepancy, returned, approved and replacement/superseded workflows
      pass end to end.

sf mn , n## Phase 7 - Credits module

Implementation:

- [x] Create branch wallets, expiring credit lots, canonical immutable transactions
      and constrained deferred-deduction obligations.
- [x] Allocate verified subscription credits idempotently to the selected branch with
      plan-bounded one-month expiry.
- [x] Persist immutable 75%, 90% anuk  ,g kji y n  , mnd 100% threshold alerts exactly once per lot.xildi
- [x] Stop ordinary verification when no eligible branch lot is available.
- [x] Define all six PDF credit event types and their source-lot/actor/audit fields;
      grant, expiry, deferred and adjustment writers remain iterative work.
- [x] Ensure the ordinary verification balanerfce never becomes negative.

Expected:

- [x] Available credit, lots and canonical history are branch-specific.
- [x] Retry/poll/webhook never deduct additional cre g k    i dits.

Completion:

- [x] Expiry, alert, concurrency, audit and non-negative tests pass.

## Phase 7 - Subscriptions module

Implementation:

- [x] Seed Starter 10,000/8,000 ETB, Professional 20,000/13,000 ETB and Business 30,000/18,000 ETB.
- [x] Enforce one-month period and no independent top-up.
- [x] Implement branch purchase and matching Platform payment account.
- [x] Connect upload/scan QR extraction to Verify.ET.
- [x] Activate and invoice only after exact verified payment.
- [x] With credits, consume one initial credit even if payment verification fails.
- [x] At zero, create one idempotent deferred obligation for the branch subscription
      order while ordinary verification remains stopped.
- [x] On successful verified grant, atomically settle one deferred credit to
      9,999/19,999/29,999.
- [x] On failure, keep zero, create no negative balance and record provider attempt evidence.
- [x] Classify and aggregate fraud evidence in Phase 8.

Expected:

- [x] Each purchase has plan, branch, proof, provider, credit and invoice traceability.
- [x] Credits are never granted for mismatch, duplicate or failed payment.

Completion:

- [x] All three plans pass existing-credit and zero-credit E2E scenarios, including
      exact invoice/grant counts and 9,999/19,999/29,999 zero-credit results.

## Phase 8 - Fraud module

Implementation:

- [x] Detect already-redeemed subscription proof.
- [x] Classify same-day reuse as duplicate upload.
- [x] Classify later-day reuse as suspected fraud.
- [x] Notify Super Admin about later-day suspected fraud.
- [x] Count qualifying attempts and lock purchasing on the third within the rule window.
- [x] Keep existing branch verification available while valid credits remain.
- [x] Implement review actions and single-use Recovery Authorization Code.

Expected:

- [x] Duplicate/fraud attempts never grant credits.
- [x] Every implemented classification, counter and lock decision is audited.
- [x] Every review and recovery decision is audited.

Completion:

- [x] Date classification, lock threshold, notification and recovery tests pass.

## Phase 8 - Notifications module

Implementation:

- [x] Implement templates/preferences/delivery logs and Firebase push.
  - [x] Add typed templates and recipient-scoped channel preferences.
  - [x] Extend delivery-attempt history for provider results and retries.
  - [x] Keep Firebase behind a fail-closed provider port pending credentials.
  - [x] Add encrypted, ownership-isolated device-token registration.
  - [x] Add the opt-in Firebase HTTP v1 service-account adapter.
- [x] Deliver every role-specific event in the PDF recipient matrix.
  - [x] Deliver idempotent subscription-fraud alerts to active Platform Super Admins.
  - [x] Deliver transaction pending/final updates only to the submitting user.
  - [x] Deliver Waiter device-session events only to that Waiter.
  - [x] Deliver credit thresholds only to active owners/managers whose work scope
        covers the affected branch.
  - [x] Deliver sanitized provider incidents only to active Platform Super Admins.
  - [x] Connect manual deposits, withdrawals, corrections and reconciliation
        decisions to their PDF-listed business recipients.
- [x] Retry safely without duplicate user-visible domain effects.
  - [x] Enforce a unique notification idempotency key at the database boundary.
  - [x] Add lease-based worker claims, bounded backoff and terminal failure state.

Expected:

- [x] Waiter pending/device events and web role credit/finance/fraud/incident events reach
      only authorized recipients.
  - [x] Waiter pending/final transaction and device-session events are isolated.
  - [x] Credit, fraud and provider-incident recipient scopes are enforced in SQL.
  - [x] Manual-finance and reconciliation recipient events are connected.

Completion:

- [x] Recipient, preference, failure/retry and redaction tests pass.
  - [x] Recipient isolation, preference mutation and unconfigured-provider tests pass.
  - [x] Retry classification, encryption and token-redaction tests pass.
  - [x] Configured Firebase contract and retry-exhaustion tests pass.

## Phase 9 - Reports module

Implementation:

- [x] Implement all PDF-listed verification, financial, credit, subscription,
      provider and fraud reports.
  - [x] Implement the bounded financial-summary report over immutable ledger entries.
  - [x] Implement branch-scoped verification, credit, subscription and fraud summaries.
  - [x] Implement a sanitized Platform Super Admin provider-health summary.
- [x] Keep Manual Deposit a separate financial category.
- [x] Apply role/business/branch scope to data and exports.
  - [x] Enforce authenticated business and branch scope for financial summaries.
  - [x] Enforce authenticated business/branch scope for operational summaries and
        isolate global provider health to Platform Super Admins.
- [x] Run large exports as background jobs.

Expected:

- [x] Dashboard and export totals match source transactions/ledger.
  - [x] Financial-summary totals are calculated directly by PostgreSQL from scoped
        ledger rows and preserve every entry category.
- [x] Export cannot broaden the caller's scope.

Completion:

- [x] Report reconciliation, permission and load tests pass.
  - [x] Report/export reconciliation and permission tests pass.
  - [x] Report and export load thresholds pass with 250,000 ledger rows and
        100,000 verification attempts in the rollback-only PostgreSQL harness.

## Phase 9 - Audit module

Implementation:

- [ ] Record every PDF-listed identity, configuration, verification, subscription,
      credit, financial, reconciliation, fraud and security event. Increment 2 closes
      the implemented authenticated mutation and background provider/report/archive
      surfaces; only future password/role endpoints remain outside implemented scope.
- [x] Store safe actor, scope, time, before/after metadata and correlation. Increment 1
      adds recursive secret redaction, bounded metadata/text and request correlation.
- [x] Prevent application users from altering audit records. PostgreSQL rejects update
      and delete with SQLSTATE 55000, verified against the clean V2 integration schema.

Expected:

- [x] Investigators can query ordered, paginated decision metadata without exposing
      configured secret-key fields, bearer credentials or JWT-shaped values. Business
      queries enforce selected tenant/branch context; platform queries require the
      isolated Platform Super Admin identity.

Completion:

- [x] Audit coverage matrix has no missing sensitive action in the implemented surface;
      it identifies only endpoints that do not yet exist.

## Phase 9 - Archive module

Implementation:

- [x] Select eligible transaction receipt evidence after one year.
- [x] Package and encrypt records/evidence with manifest metadata.
- [x] Transfer to protected archive storage and verify integrity.
- [x] Remove archived receipt evidence from normal operational queries.
- [x] Implement authorized retrieval and complete archive audit.

Expected:

- [x] Archived receipt records remain retrievable and traceable but absent from active views.

Completion:

- [x] Archive encryption, integrity, retrieval, authorization and failure-recovery
      tests pass for the implemented receipt-evidence retention boundary.
- [x] A 16 MiB receipt completes the PostgreSQL/object-storage archive, verified
      deletion and exact audited retrieval exercise.

## Phase 10 - Production completion

- [x] Add Redis-backed application rate limits for global API traffic, stricter auth
      and proof-upload policies, bounded proxy trust and enforcement metrics.
- [x] Keep health/metrics probes diagnosable during Redis incidents; sensitive routes
      fail closed while general traffic records an observable protection bypass.
- [ ] Validate application limits with production-equivalent WAF/ingress and expected
      shared-NAT/mobile traffic before approving final thresholds.
- [ ] All module completion checks pass in CI.
      - [x] Root-discoverable backend workflow covers complete unit, integration,
            security, history, load, native PDF-worker and build gates on Node 20.19.
      - [x] An isolated read-only-source Node 20.19 Linux parity exercise runs the
            native PDF worker, unit suite, lint, typecheck and production build.
      - [x] All external workflow actions and CI service images use immutable commit
            or image-digest pins enforced by a repository validation gate.
      - [x] Weekly reviewed npm, Docker and GitHub Actions update lanes keep immutable
            references refreshable without automatic merge or policy bypass.
      - [x] GitHub dependency graph enablement was confirmed by the repository operator
            on 2026-08-14; retain a settings-page reference with release evidence.
      - [x] Pull requests run an immutable, read-only dependency-review gate that
            rejects newly introduced high/critical runtime vulnerabilities.
      - [x] Explicit API and worker image targets have role-correct commands and health
            behavior, and CI builds, scans, contract-checks and attests both images.
      - [x] A guarded local rehearsal starts API and worker independently against the
            dependency stack and proves both reject invalid production configuration.
      - [ ] Dependabot alerts and security updates are enabled in repository settings.
      - [ ] Default-branch protection requires dependency review and complete backend CI.
      - [ ] The new root workflow completes successfully on the hosted CI runner.
      - [x] Release evidence fails closed unless repository security and branch
            protection settings have HTTPS proof tied to the required checks.
- [ ] Verify.ET production key/webhook specification is configured outside source.
- [ ] Platform receiving accounts and final bank QR samples are approved.
- [ ] Backup restoration, load, security and incident exercises pass.
      - [x] Local encrypted restore, report/Redis load, security, provider/queue incident
            and immutable-image deployment/rollback exercises pass.
      - [ ] Production/staging exercises complete with approved operator evidence.
- [ ] Monitoring alerts and runbooks have named owners.
- [x] A strict secret-free release-evidence manifest validates every remaining external
      approval, owner, drill, CI, vendor, bank and infrastructure reference before GO.
- [x] A repeatable all-reachable-commit history scan found no real key or
      non-fixture full account number; synthetic account fixtures are counted separately.
