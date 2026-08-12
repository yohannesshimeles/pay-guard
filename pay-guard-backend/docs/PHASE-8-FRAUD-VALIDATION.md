# Phase 8 Fraud Validation

## Increment 1 - Subscription proof reuse and purchase lock

Implemented:

- redeemed subscription references are serialized by bank and reference before a
  duplicate decision;
- same-calendar-day reuse is stored as `SAME_DAY` and does not create a qualifying
  fraud attempt;
- later-calendar-day reuse is stored as `CROSS_DAY_FRAUD` with immutable evidence;
- the active database rule counts attempts per business over 30 days and locks new
  subscription purchases on attempt three;
- exact purchase idempotency replays remain readable, while a new purchase is rejected
  when a lock is `ACTIVE` or `RECOVERY_ISSUED`;
- duplicate and fraud outcomes create no subscription, invoice, or credit grant;
- the verification audit record includes classification, attempt number, and lock state;
- no lock check was added to customer verification or credit consumption paths.

Database controls:

- `subscription_fraud_rules` persists the threshold and window;
- `subscription_fraud_attempts` is protected against update and delete;
- one qualifying evidence row is allowed per verification/order;
- only one active or recovery-issued purchase lock is allowed per business;
- advisory locks serialize reference classification and per-business attempt counting.

Validation:

- migration `035_v2_subscription_fraud_foundation.sql` applied successfully;
- unit tests cover same-day, cross-day, PostgreSQL date normalization, and locked
  purchase response mapping;
- V2 integration validates three sequential cross-day attempts, immutable evidence,
  zero invoices/grants, one purchase lock, and rejection of a new purchase;
- lint, build, all 396 unit tests, and all 23 V2 integration tests pass;
- no dependency or lockfile changed in this increment. The last production audit passed
  with zero vulnerabilities; a fresh registry audit requires network access.

Remaining Phase 8 work:

- Super Admin fraud notifications and review APIs;
- single-use Recovery Authorization Code generation, secure delivery, redemption,
  unlock, expiry, and revocation;
- notification delivery infrastructure and final Phase 8 end-to-end completion gate.

## Increment 2 - Super Admin alerts and review queries

Implemented:

- every cross-day subscription reuse creates one idempotent
  `SUBSCRIPTION_CROSS_DAY_REUSE` security alert in the same transaction as its fraud
  evidence;
- attempts below the threshold are `HIGH`; the threshold-triggering attempt is
  `CRITICAL`;
- alert payloads contain identifiers and policy outcomes but no raw proof content or
  complete transaction reference;
- `GET /api/v1/platform/fraud-reviews` supports status, severity, business, limit and
  offset filters;
- `GET /api/v1/platform/fraud-reviews/:fraudReviewId` returns one structured evidence
  view;
- responses mask transaction references and expose business, branch, dates, policy,
  alert and active purchase-lock context;
- both routes require an authenticated identity whose type is `PLATFORM_ADMIN` and
  whose role is `PLATFORM_SUPER_ADMIN`.

Validation:

- migration `036_v2_subscription_fraud_alerts.sql` applied successfully;
- unit tests reject a business identity carrying a forged Super Admin role and validate
  list filters/not-found mapping;
- V2 integration proves exactly three alerts for three qualifying attempts, severity
  progression `HIGH`, `HIGH`, `CRITICAL`, masked references and list/detail retrieval;
- notification creation remains atomic with fraud evidence and does not alter credit,
  invoice, subscription or customer-verification behavior.

Remaining after Increment 2:

- explicit Super Admin review actions;
- single-use Recovery Authorization Code generation, delivery, expiry, revocation and
  redemption;
- audited purchase unlock and final Phase 8 notification/recovery end-to-end tests.

## Increment 3 - Recovery authorization and purchase unlock

Implemented:

- Platform Super Admin can approve an open fraud review and issue a cryptographically
  random Recovery Authorization Code to one active Owner;
- only a SHA-256 hash is stored; the plaintext code is returned once at issuance and is
  excluded from audit metadata;
- a request UUID prevents accidental issuance replay and only one active code may exist
  for a purchase lock;
- codes expire after a bounded 5-60 minute interval, defaulting to 15 minutes;
- an expired active code is revoked transactionally before a replacement is issued;
- Platform Super Admin can explicitly revoke an unused code with a required reason;
- only the intended active Owner in the exact business context can redeem a valid code;
- redemption marks the code `USED`, marks the purchase lock `UNLOCKED`, clears related
  open fraud flags and writes the Owner audit record in one transaction;
- used, revoked, expired, wrong-user, wrong-business and unknown codes share one generic
  response to prevent authorization-code enumeration;
- successful redemption permits new subscription purchasing while leaving historical
  fraud evidence and audit records intact.

Endpoints:

- `POST /api/v1/platform/fraud-reviews/:fraudReviewId/recovery-authorizations`;
- `POST /api/v1/platform/fraud-reviews/:fraudReviewId/recovery-authorizations/:recoveryCodeId/revoke`;
- `POST /api/v1/businesses/:businessId/subscription-purchase-lock/recover`.

Validation completed:

- targeted fraud lint passes;
- production build passes;
- all 78 unit suites and 403 unit tests pass;
- security unit tests validate random code generation, hash-only persistence, no secret
  audit leakage, strict platform identity, exact Owner context and generic invalid-code
  handling.

Database validation completed:

- migration `037_v2_recovery_authorization.sql` is applied;
- all 23 V2 database integration tests pass;
- integration validates issuance to the intended Owner, one successful redemption,
  replay rejection, atomic purchase unlock, related fraud closure and a successful new
  subscription purchase after unlocking;
- Phase 8 fraud classification, threshold lock, Super Admin alert/review and recovery
  authorization acceptance checks are complete.

## Increment 4 - Recipient-isolated notification delivery

Implemented:

- durable typed notification templates, per-recipient channel preferences and provider
  delivery-attempt history;
- encrypted, ownership-isolated Firebase device registration and an opt-in Firebase
  HTTP v1 adapter that remains fail-closed until credentials are configured;
- lease-based delivery claims, bounded retries, terminal failure handling and unique
  idempotency keys so retrying delivery cannot repeat a financial domain operation;
- transaction pending/final updates only for the submitting user and device-session
  events only for the affected Waiter;
- branch credit alerts only for active Owners and Managers whose current work scope
  covers the affected branch;
- sanitized provider incidents and subscription fraud alerts only for active Platform
  Super Admins;
- manual deposit and withdrawal notifications for the branch's active financial
  oversight recipients;
- Manager correction notifications for other authorized branch oversight recipients;
- reconciliation-submission notifications for authorized reviewers and immutable
  approved/returned outcome notifications for the submitting Cashier;
- all finance/reconciliation notifications are written in the same database transaction
  as their source operation and omit account numbers, amounts, recipient details and
  free-text reasons.

Database validation:

- migrations `038_v2_notification_foundation.sql` through
  `041_v2_financial_notifications.sql` are applied to the development database;
- a clean disposable `payguard_v2_test` database accepts migrations 001-041;
- the V2 integration harness now applies migrations 038-041, preventing tests from
  running against a pre-notification schema.

Completion evidence:

- Firebase HTTP v1 contract tests validate OAuth exchange, bearer authentication,
  request shape and retryable 429 classification without leaking provider responses;
- delivery tests validate retry classification and terminal failure after exhaustion;
- audience tests validate role, branch, active-assignment and immutable-submitter
  isolation plus financial-message redaction;
- all 85 unit suites and 426 unit tests pass;
- all 23 V2 integration tests pass against PostgreSQL;
- lint, production build and the production dependency security audit pass;
- Phase 8 fraud, recovery and notification acceptance checks are complete. Live push
  delivery requires genuine Firebase credentials at deployment and is intentionally
  disabled when they are absent.
