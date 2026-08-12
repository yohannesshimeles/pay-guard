# PayGuard Backend Architecture

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## 1. Deployment architecture

The backend starts as a modular monolith with strict feature boundaries and separately
scalable worker processes:

```text
Web CDN/WAF ----\
                 -> PayGuard API -> PostgreSQL
Android --------/        |       -> S3-compatible object storage
                         |
                         +-------> Redis/BullMQ -> worker processes
                                                   | Verify.ET
                                                   | push notifications
                                                   | exports/archive
```

- PostgreSQL is the transactional system of record.
- Redis supports BullMQ, status caching, idempotency locks and short-lived rate-limit
  state. PostgreSQL constraints/transactions remain the final correctness boundary.
- Workers handle Verify.ET polling, pending rechecks, notification delivery, reports,
  exports and one-year archiving.
- Object storage holds protected payment documents, receipt evidence, exports and
  encrypted archive packages.
- OpenTelemetry, Prometheus-compatible metrics and centralized redacted logs cover API,
  queues, webhooks and provider incidents.

## 2. Code organization

Database access is layered. `DatabaseService` exclusively owns the PostgreSQL pool
and transaction lifecycle. The global `CentralDao` provides consistent typed query,
cardinality and transaction semantics. Feature-specific DAOs own their SQL and row-
to-entity mapping; the central DAO must not accumulate business-module queries.
Pool lifetime, keepalive, timeout, reset handling and production sizing are defined
in `DATABASE-CONNECTION-POOLING.md`.

```text
src/
  modules/
    auth-sessions/
    businesses/
    branches/
    users/
    banks-settlement/
    qr-processing/
    verify-et/
    verifications/
    transactions/
    ledger/
    credits/
    subscriptions/
    fraud/
    reconciliation/
    notifications/
    reports/
    audit/
    archive/
  common/
    database/ config/ errors/ security/ observability/
  api/
  workers/
```

Each module owns its controllers, application services, domain rules and persistence.
Cross-module access uses an exported application interface or a durable event. No
feature imports another feature's private repository.

## 3. Module responsibilities

| Module | Responsibility |
| --- | --- |
| Auth and Sessions | Login, refresh, logout, password reset, RBAC, tenant/branch context and one-device Waiter sessions |
| Businesses | Self-registration, Owner links, activation, suspension and status history |
| Branches | Branch settings, staff assignments, credits, accounts and branch rules |
| Users | Manager/Cashier/Waiter creation, soft-removal, session revocation and historical preservation |
| Banks and Settlement | Supported banks, one account per bank/branch, encrypted account values, derived suffixes and Platform subscription accounts |
| QR Processing | JPG/JPEG/PNG/PDF evidence, camera-image QR extraction, bank detection and receipt parsing |
| Verify.ET | Provider client, bank adapters, idempotency, webhook signatures, polling, retry and provider monitoring |
| Verifications | State machine, matching, pending rechecks, duplicates and terminal outcomes |
| Transactions | Operational payment record and provider-result history |
| Ledger | Immutable entries, calculated balances and compensating corrections |
| Credits | Branch wallets/lots, expiry, reservation, deduction and deferred subscription deductions |
| Subscriptions | Three monthly plans, purchases, proof verification, activation and invoices |
| Fraud | Duplicate receipt classification, counters, purchase locks, recovery codes and reviews |
| Reconciliation | Daily Cashier submission and Manager decision |
| Notifications | Firebase push, templates, preferences and delivery logs |
| Reports | Role-scoped analytics and background exports |
| Audit | Sensitive actions with safe before/after metadata and correlation IDs |
| Archive | One-year active retention, encrypted archive batches and authorized retrieval |

## 4. Tenant and authorization boundaries

- Only Platform Super Admin can query across businesses.
- An Owner queries only businesses linked through `business_owners`, always in an
  explicit business context.
- Manager, Cashier and Waiter belong to exactly one branch.
- Every branch record includes business/branch context and repository queries bind
  that context from the authenticated session, not from an untrusted request alone.
- Waiter responses contain their own transactions/counts only and no balances,
  subscription plans or other employees' transactions.
- Full settlement account values have restricted decryption paths; normal responses
  return bank and masked account.

## 5. Core state models

Verification processing:

`QR_RECEIVED -> VALIDATING -> SUBMITTED -> API_QUEUED -> API_RUNNING`

Payment outcomes:

`PAYMENT_PENDING | VERIFIED | FAILED | DUPLICATE | AMOUNT_MISMATCH |
ACCOUNT_MISMATCH | BANK_UNAVAILABLE | PROVIDER_UNAVAILABLE |
BRANCH_CREDITS_EXHAUSTED`

Subscription:

`PLAN_SELECTED -> PROOF_UPLOADED -> QR_DETECTED -> PAYMENT_PENDING ->
PAYMENT_VERIFIED -> ACTIVATED`

`PURCHASE_LOCKED` is entered by the confirmed fraud rule. Ledger entries are `POSTED`,
then may be related to a `REVERSED_BY_ADJUSTMENT` record or become `ARCHIVED`; posted
records are never edited or deleted.

## 6. Verify.ET adapter architecture

Only this backend calls:

- `POST /api/verify` for an initial customer/subscription payment verification
- `GET /api/verify/:requestId` for polling and webhook revalidation
- `GET /api/verify/:requestId/events` for optional internal live operations
- `GET /api/verify/history` for reconciliation/incident analysis
- `POST /api/verify/test-webhook` for pre-production callback validation

Bank adapter payload rules:

| Bank | Required payload |
| --- | --- |
| CBE | Reference plus last 8 account digits |
| BOA | Reference plus last 5 digits |
| Telebirr | Transaction/reference plus settlement wallet matching |
| M-Pesa | Transaction/reference; URL/SMS-derived values supported |
| CBE Birr | Receipt/reference plus phone |
| Dashen | Reference |
| Awash | Reference; optional host/token detection |
| Siinqee | Reference; optional host/token detection |
| Kaafi e-birr | Reference; phone optional |
| Zemen | Direct verification unsupported |

Provider responses map exactly as follows: 401 stops submission and alerts Super
Admin; 402 reports provider credits exhausted; 403 is a configuration incident with
no blind retry; 409 rejects changed idempotent payload and logs investigation data;
422 becomes a sanitized validation failure; 429 honors `Retry-After`; 503 uses the
returned request/status URL when available, otherwise retries safely.

Webhooks validate signature, delivery ID, limits and schema, acknowledge quickly and
enqueue processing. Delivery ID is unique; replay cannot repeat credit or ledger effects.

## 7. Verification and duplicate flow

1. Resolve user, business and branch scope.
2. Reject ordinary customer verification if branch credits are zero.
3. Validate/parse QR or proof, then select the bank adapter.
4. Create an idempotent verification attempt and consume/reserve exactly one credit for
   the initial request under the approved credit policy.
5. Submit to Verify.ET. Polling, webhook handling and automatic retries use the same
   attempt and consume no additional credit.
6. Match reference, exact amount, configured date/time tolerance, receiver settlement
   account and provider status.
7. A successful customer payment creates one transaction confirmation and one
   `VERIFIED_PAYMENT` ledger entry atomically.
8. Pending stays yellow and is automatically rechecked; Manager cannot approve it.
9. A duplicate records the attempt but never increases the balance a second time.

Unique bank/reference/receiver confirmation constraints and idempotency keys protect
against concurrent duplicate posting.

## 8. Subscription and credit transaction

Plans are fixed monthly products:

| Plan | Credits | Price | Expiry |
| --- | ---: | ---: | --- |
| Starter | 10,000 | 8,000 ETB | End of one-month period |
| Professional | 20,000 | 13,000 ETB | End of one-month period |
| Business | 30,000 | 18,000 ETB | End of one-month period |

No independent top-up exists. Owner selects business/branch/plan/payment bank.
The bank determines the active Platform subscription settlement account. Proof is
uploaded or camera-scanned, QR is extracted, and Verify.ET validates reference,
exact plan amount, date/time, receiver and duplicate history.

With existing branch credit, the initial request consumes one credit whether
verification succeeds or fails. A technical retry, poll or webhook consumes none.

At zero credits, only subscription renewal bypasses the normal stop:

1. Create purchase and one unresolved deferred deduction.
2. Submit subscription verification.
3. On failure, keep balance at zero and record platform cost/fraud data.
4. On success, atomically grant plan credits and settle one deferred credit:
   9,999 / 19,999 / 29,999 available respectively.

Credit event types are `SUBSCRIPTION_CREDIT_GRANT`, `VERIFICATION_DEDUCTION`,
`SUBSCRIPTION_VERIFICATION_DEFERRED`, `DEFERRED_DEDUCTION_SETTLED`,
`CREDIT_EXPIRY` and audited `ADMIN_ADJUSTMENT`.

Same-day redeemed-proof reuse is a duplicate and grants no credits. Later-day reuse
creates suspected fraud. Three qualifying attempts in the configured window lock
credit purchasing while valid credits continue to support existing branch verification.
The initial persisted rule is three qualifying attempts in 30 days; it is stored in
`subscription_fraud_rules` so later policy changes do not require application-code edits.

## 9. Ledger and reconciliation

Calculated balance:

`opening + verified payments + manual deposits - withdrawals
+/- corrections`

Entry types and creators:

- `OPENING_BALANCE` - Owner/authorized setup, increase
- `VERIFIED_PAYMENT` - verification engine, increase
- `MANUAL_DEPOSIT` - Cashier, increase
- `WITHDRAWAL` - Cashier, decrease
- `CORRECTION_INCREASE` / `CORRECTION_DECREASE` - Manager
- `REVERSAL` - Manager-approved compensating effect

Posting and projected/current balance use one database transaction with row-level
protection. Every entry holds business, branch, settlement account, effective time,
creator, reason and audit correlation. Attachments use validated protected storage.

Reconciliation computes all categories separately and moves through `DRAFT`,
`SUBMITTED`, `MATCHED` or `DISCREPANCY`, then `APPROVED` or `RETURNED`.

## 10. Core database entities and constraints

Identity: `users`, `roles`, `permissions`, `user_roles`, `sessions`, `devices`,
`password_reset_tokens`.

Tenancy: `businesses`, `business_owners`, `branches`,
`branch_user_assignments`, `settings`.

Banking: `banks`, `settlement_accounts`, `subscription_settlement_accounts`.

Verification/transactions: `verification_attempts`, `provider_requests`,
`provider_responses`, `status_events`, `webhook_deliveries`,
`pending_recheck_jobs`, `transactions`, `transaction_status_history`, `receipts`,
`transaction_confirmations`, `duplicate_attempts`.

Finance: `ledger_accounts`, `ledger_entries`, `withdrawals`, `corrections`, `reversals`,
`reconciliations`, `branch_credit_wallets`, `credit_lots`,
`credit_transactions`, `deferred_credit_deductions`.

Subscription/fraud/operations: `subscription_plans`, `subscription_purchases`,
`subscription_payments`, `active_subscriptions`, `invoices`, `fraud_events`,
`fraud_attempts`, `recovery_authorization_codes`, `fraud_reviews`, `trust_scores`,
`notifications`, `notification_deliveries`, `audit_logs`, `export_jobs`,
`archive_jobs`, `archive_batches`.

Constraints include unique active settlement account per bank/branch, unique provider
request/delivery IDs, unique confirmation per bank/reference/receiver, one active
Waiter device, non-negative ordinary credit balances, at most one unresolved deferred
deduction per purchase, and application-level prohibition on posted ledger mutation.

## 11. API boundary

The API exposes the PDF-defined `/auth`, `/businesses`, `/branches`, `/users`,
`/settlement-accounts`, `/manual-deposits`, `/verifications`,
`/subscription-plans`, `/subscription-purchases`, `/credits`, `/reconciliations`,
`/platform/subscription-settlement-accounts`, `/reports/exports` and
`/webhooks/verify-et` resources.

Responses use consistent success/message/data/error envelopes, correlation IDs,
role-appropriate masking and sanitized provider errors. Verification and financial
posting endpoints require idempotency.

## 12. Security and operations

- Managed, scoped and rotated Verify.ET/webhook secrets.
- TLS for all client/provider connections.
- Server-side RBAC and tenant/branch scoping on every query/mutation.
- Encrypted account numbers, backups and archive storage.
- Database transactions, idempotency and immutable ledger posting.
- Upload MIME/size validation, malware scanning, signed URLs and protected storage.
- Webhook signatures, delivery deduplication, payload limits and fast acknowledgement.
- Short access tokens, rotated refresh tokens and session/device revocation.
- WAF, request validation, rate limits, abuse monitoring and sanitized logs.
- Audit all PDF-listed identity, account, verification, subscription, credit,
  financial, reconciliation, fraud and security actions.

Unresolved production inputs are listed in the project plan, not invented here.
