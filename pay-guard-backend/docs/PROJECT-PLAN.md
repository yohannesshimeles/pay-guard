# PayGuard Backend Project Plan

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

Execution details and module-level completion checks are in
`MODULE-IMPLEMENTATION-CHECKLIST.md`.

## Phase 1 - Foundation

Deliver:

- Convert the starter to NestJS and strict TypeScript.
- PostgreSQL migrations, Redis/BullMQ and local infrastructure.
- Authentication, refresh/logout/reset, RBAC, tenant/branch context and audit shell.
- Logging, correlation IDs, OpenTelemetry, metrics and CI/CD.
- Object-storage abstraction and configuration/secrets validation.

Exit: role-aware authentication works and business/branch data is isolated.

## Phase 2 - Core business setup

Deliver businesses/self-registration, Owner links, branches, Manager/Cashier/Waiter
creation, soft-removal with dependency check/session revocation/history preservation,
banks, branch settlement accounts and encrypted account values.

Exit: an Owner can configure a branch and staff securely.

## Phase 3 - Verification platform

Deliver document/image QR parsing, bank adapters, Verify.ET test client, idempotent
submission, polling, signed webhooks, provider errors/retry, status history, credit
deduction and duplicate protection.

Exit: end-to-end customer payment verification works in the test environment.

## Phase 4 - Android-enabling APIs

Deliver Waiter login/device registration, one-device invalidation, own metrics/history,
scan submission, live status, pending updates and Firebase notification delivery.

Exit: Android can verify a payment through PayGuard with no provider secret.

## Phase 5 - Ledger operations

Deliver opening/verified/manual-deposit/withdrawal/correction/reversal
entries, projected/calculated balances, immutable posting, attachments and audit.

Exit: balance formula and immutable ledger are validated under concurrent requests.

## Phase 6 - Manager and Cashier operations

Deliver manual-deposit review/flag/correction, pending rechecks, daily reconciliation
and decision states, branch operational dashboards and notification events.

Exit: daily branch operations can be completed entirely through supported APIs.

## Phase 7 - Subscriptions and credits

Status: complete. The six-plan-mode matrix and failed/duplicate safety gates pass.

Deliver the three monthly plans, Platform subscription settlement accounts, branch
purchase context, upload/scan proof pipeline, activation/invoices, expiry, available-
credit deduction and zero-credit deferred deduction.

Exit: each plan activates with the exact credit result; zero-credit Starter yields
9,999, Professional 19,999 and Business 29,999 available.

## Phase 8 - Super Admin and fraud

Deliver provider/credit/system monitoring, fraud events, duplicate rules, purchase
locks, recovery authorization codes, trust/review data, platform revenue and global
controls.

Exit: platform operations and risk review are production-ready.

## Phase 9 - Reports and archive

Deliver role-scoped reports/exports, one-year eligibility jobs, encrypted archive
batches, active-query removal, authorized retrieval and archive audit views.

Exit: reporting and retention obligations in the PDF are met.

## Phase 10 - Production hardening

Deliver security review, load tests, backup restore test, WAF/rate limits, provider
and queue incident runbooks, monitoring/alerts and production deployment rehearsal.

Exit: all test-checklist release gates pass and launch approval is recorded.

## Required external inputs

- New, non-exposed Verify.ET production API key and scoped permissions.
- Verify.ET webhook secret and exact signature specification.
- Confirmed Platform subscription settlement accounts for supported banks.
- Final QR formats and bank-specific receipt samples.
- Production domains, hosting and object-storage location.
- Approved privacy policy, terms and operational data handling.
- Firebase project configuration needed by notification delivery.

No real key or full account number may enter source, documentation or screenshots.
