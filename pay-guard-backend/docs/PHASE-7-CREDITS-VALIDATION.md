# Phase 7 Credits Validation

Status: Complete - all six increments and the Phase 7 exit matrix pass

## Increment 1 - Branch wallet and expiring credit-lot foundation

Implemented:

- Migrations `027_v2_credit_lot_foundation.sql` and
  `028_v2_canonical_credit_branch_scope.sql` add branch-owned credit lots with
  allocation, used, expired and generated remaining balances, start/expiry times and
  active/exhausted/expired states.
- Existing branch-wallet balances are backfilled into one migration lot without
  changing their purchased/used/expired/available totals.
- Credit history now uses the six canonical event types:
  `SUBSCRIPTION_CREDIT_GRANT`, `VERIFICATION_DEDUCTION`,
  `SUBSCRIPTION_VERIFICATION_DEFERRED`, `DEFERRED_DEDUCTION_SETTLED`,
  `CREDIT_EXPIRY` and `ADMIN_ADJUSTMENT`.
- Credit events can retain their source lot, actor and audit correlation. Existing
  credit-event immutability remains enforced, and canonical events require a branch;
  any referenced lot must belong to the same business and branch.
- The deferred-deduction table enforces exactly one unresolved obligation per
  subscription order and valid pending/settled/cancelled metadata combinations.
- Initial customer verification selects the earliest-expiring active lot under a
  PostgreSQL row lock, consumes one lot credit and one wallet credit atomically, and
  records one idempotent `VERIFICATION_DEDUCTION` event.
- Recheck, polling and webhook paths reuse the initial credit event and do not deduct
  a second credit. If no eligible non-expired lot exists, ordinary verification waits
  for credits without allowing a negative balance.
- `GET /api/v1/businesses/:businessId/branches/:branchId/credits` returns the scoped
  wallet and its lots. `GET .../credits/history` returns bounded canonical history and
  supports an allow-listed `eventType` filter.
- Owners can read branches within their business. Manager and Cashier access is
  restricted to their exact active authentication branch context.

Validation evidence:

- [x] Focused credit validation passes: 2 suites and 10 tests.
- [x] Full unit regression passes: 72 suites and 378 tests.
- [x] V2 PostgreSQL regression passes: 1 suite and 17 tests.
- [x] PostgreSQL acceptance proves wallet and lot decrement together, canonical event
      persistence, free rechecks, and authorized wallet/lot/history API responses.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] Migrations `027` and `028` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 2 - Subscription grants, thresholds and expiry

Implemented:

- Migration `029_v2_credit_lifecycle.sql` links subscription orders and active
  subscriptions to their selected branch and adds immutable 75%, 90% and 100%
  threshold records.
- `CreditLifecycleService.grantSubscription` is an internal backend operation. It
  accepts only an active, verified, exact-branch subscription whose credit allocation
  matches the immutable purchase snapshot and whose period does not exceed the plan
  duration.
- A grant locks the subscription and branch wallet, creates one expiring lot, updates
  purchased/available balances, records one `SUBSCRIPTION_CREDIT_GRANT`, and links the
  lot to that event in one transaction.
- The lot UUID and event key form replay evidence. Exact replay returns the original
  result; changed business, branch, subscription, lot, key or allocation conflicts.
- Initial verification emits newly crossed 75/90/100 thresholds after its atomic lot
  deduction. Unique `(credit_lot_id, threshold_percent)` prevents duplicate alerts.
- The bounded expiry processor claims due active lots using row locks and
  `SKIP LOCKED`, moves all remaining credits from available to expired, marks the lot
  expired, records one `CREDIT_EXPIRY`, and records all newly crossed thresholds in
  the same transaction.
- Re-running expiry returns no work and creates no duplicate event. Wallet responses
  now include the latest immutable threshold records for authorized branch users.

Validation evidence:

- [x] Focused credit lifecycle validation passes: 3 suites and 13 tests.
- [x] Full unit regression passes: 73 suites and 381 tests.
- [x] V2 PostgreSQL regression passes: 1 suite and 17 tests.
- [x] PostgreSQL acceptance grants 10,000 once, replays without another grant,
      expires the lot once, preserves `purchased = used + expired + available`, and
      records exactly one grant, one expiry, and thresholds 75/90/100.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] Migration `029` is applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 3 - Zero-credit deferred subscription deduction

Implemented:

- Migration `030_v2_deferred_credit_integrity.sql` makes branch linkage mandatory for
  new subscription orders/subscriptions and adds composite business/branch foreign
  keys across purchases, deferred obligations and their canonical credit events.
- `deferSubscriptionVerification` is an internal operation for an eligible active
  branch purchase. It creates the branch wallet when absent, locks the purchase and
  wallet, and proceeds only when available credits equal zero.
- The first call records one zero-delta `SUBSCRIPTION_VERIFICATION_DEFERRED` event,
  one pending obligation and the purchase's verification-pending state in a single
  transaction. Exact replay returns the same evidence; changed IDs, event keys,
  branch/business/order scope or a non-zero balance conflict.
- The database permits at most one pending deferred obligation per order. Its source,
  scope, reason and creation evidence cannot be changed or deleted; only explicit
  pending-to-settled/cancelled transitions are accepted.
- A successful verified subscription grant locks the pending obligation and consumes
  exactly one credit from the newly granted lot and wallet. It writes one
  `DEFERRED_DEDUCTION_SETTLED` event and settlement metadata in the grant transaction.
- Grant replay detects the settled obligation and returns the same final balance
  without another grant or deduction. Failed/uncompleted verification leaves the
  wallet at zero and the single obligation pending.

Validation evidence:

- [x] Focused lifecycle service validation passes: 5 tests.
- [x] Full unit regression passes: 73 suites and 383 tests.
- [x] V2 PostgreSQL regression passes: 1 suite and 18 tests.
- [x] PostgreSQL acceptance validates zero-credit deferral and exact replay for all
      three plans, one grant plus one settlement event, no remaining pending item,
      and final balances of 9,999, 19,999 and 29,999.
- [x] Direct deletion of settled deferred evidence is rejected by PostgreSQL.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] Migration `030` is applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 4 - Owner subscription purchase and proof intake

Implemented:

- Migrations `031_v2_subscription_purchase_intake.sql` and
  `032_v2_subscription_transition_compatibility.sql` add one business-scoped
  idempotency key per purchase, explicit purchase states, protected proof metadata,
  immutable plan/payment snapshots and immutable stored-proof evidence.
- `GET /api/v1/subscription-plans` returns only active plan catalog entries.
- Owners can create a branch purchase using an active plan and payment bank. The
  database resolves the bank's one active Platform settlement account and snapshots
  the plan name, credits, price and duration in the same transaction.
- Purchase creation requires the exact active Primary/Additional Owner membership,
  active business and active branch. A repeated identical UUID is returned as a
  replay; changed request content conflicts.
- Scoped Owner list and detail routes never query outside the selected business and
  branch. Responses expose only the masked Platform account value.
- The proof endpoint reuses the bounded MIME/signature validation, malware scanning,
  image/PDF QR decoding and private object-storage controls used by transaction
  receipts. Only a hash of the raw QR value is persisted.
- One immutable proof is allowed per purchase. Upload changes the order only to
  `PROOF_RECEIVED`; it does not invoke Verify.ET, grant credits or mutate a wallet.
- Failed database persistence compensates by deleting the uploaded private object.
  Both creation and proof receipt produce business/branch-scoped audit events.

Validation evidence:

- [x] Focused subscription service validation passes: 1 suite and 5 tests.
- [x] Full unit regression passes: 74 suites and 388 tests.
- [x] V2 PostgreSQL regression passes: 1 suite and 19 tests.
- [x] PostgreSQL rejects purchase-snapshot mutation and proof metadata mutation.
- [x] The zero-credit deferred verification lifecycle remains compatible.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] Migrations `031` and `032` are applied to local `payguard_v2`; status has no
      pending V2 migrations.
- [x] No dependency or lockfile changes; the prior production audit remains valid.

## Increment 5 - Verify.ET matching, activation and atomic credit grant

Implemented:

- Migration `033_v2_subscription_verification.sql` adds normalized Platform account
  suffixes, parsed proof matching fields, one idempotent verification per order,
  provider outcome evidence and immutable final verification records.
- Newly created Platform subscription accounts retain the normalized encrypted-value
  suffix separately from their masked display value. Existing accounts without this
  derived suffix cannot be used for subscription verification until safely replaced.
- `POST .../subscription-purchases/:purchaseId/verify` requires the exact Owner
  business context and a `SINGLE_QR` proof whose bank identifier, plan price and full
  receiver suffix match the immutable purchase selection.
- Existing-credit branches consume exactly one FIFO credit before the provider call.
  A zero-credit branch creates/replays the deferred obligation instead. Provider
  retries use the same deterministic verification ID and idempotency key and never
  charge a second credit.
- Provider-unavailable attempts remain pending and retryable. Failed or mismatched
  provider outcomes mark the purchase failed without creating a subscription or
  credit lot.
- A verified provider response is re-matched under database locks. The database then
  marks the proof verified, activates the exact branch subscription and grants its
  expiring credit lot in one transaction. A pending deferred credit is settled inside
  that same grant transaction.
- Bank/reference duplicate serialization uses a transaction advisory lock plus a
  partial unique index. Duplicate evidence is final and cannot grant credits.
- Final outcome replay verifies stored provider identity and financial fields; changed
  replay content conflicts. Preparation and outcomes are business/branch audited.

Validation evidence:

- [x] Focused subscription verification validation passes: 4 tests.
- [x] Full unit regression passes: 75 suites and 392 tests.
- [x] V2 PostgreSQL regression passes: 1 suite and 20 tests.
- [x] PostgreSQL acceptance proves proof matching, one verification, one activated
      subscription, one credit grant and exact final replay without duplication.
- [x] Mismatch, non-Owner and provider-unavailable paths are unit validated.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] Migration `033` is applied to local `payguard_v2`; no V2 migration is pending.
- [x] No dependency or lockfile changes; the prior production audit remains valid.

## Increment 6 - Immutable invoices and Phase 7 exit matrix

Implemented:

- Migration `034_v2_subscription_invoices.sql` creates one immutable, tenant-scoped
  invoice for each verified order, subscription and provider verification.
- Invoice issuance occurs inside the verified-outcome transaction before the credit
  grant. It snapshots the plan, credits, exact ETB amount, payment reference and
  provider request identity. Failed, mismatched and duplicate outcomes cannot issue
  an invoice.
- Scoped purchase list/detail responses include invoice number, amount, currency,
  payment reference and issue time without exposing protected account or raw proof
  data.
- Invoice mutation/deletion is blocked by PostgreSQL. Replayed provider outcomes
  return the existing final result and cannot create another invoice or grant.

Phase 7 exit evidence:

- [x] Starter existing-credit result: 10,001 available after one charged verification.
- [x] Professional existing-credit result: 20,001 available.
- [x] Business existing-credit result: 30,001 available.
- [x] Starter zero-credit deferred result: 9,999 available.
- [x] Professional zero-credit deferred result: 19,999 available.
- [x] Business zero-credit deferred result: 29,999 available.
- [x] Every successful scenario creates exactly one subscription, invoice and grant.
- [x] Failed and duplicate scenarios remain at zero and create no subscription,
      invoice or grant while retaining provider attempt evidence.
- [x] Direct invoice mutation is rejected by PostgreSQL.
- [x] Full unit regression passes: 75 suites and 392 tests.
- [x] V2 PostgreSQL regression passes: 1 suite and 22 tests.
- [x] Strict lint and production TypeScript build pass.
- [x] Migrations `001` through `034` are applied locally with none pending.
- [x] No dependency or lockfile changes; the prior zero-vulnerability production
      audit remains applicable.

## Next phase

- Phase 8: duplicate/fraud date classification, purchase attempt locks, Super Admin
  review and single-use recovery authorization codes.
