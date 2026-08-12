# Phase 6 Reconciliation Validation

Status: Phase 6 core workflow implemented

## Increment 1 - Cashier daily snapshot and submission

Implemented:

- An active branch Cashier can create an idempotent daily reconciliation draft for
  an active settlement account only when an active branch reconciliation schedule
  exists.
- The schedule closing time and IANA timezone define a close-to-close accounting
  period. PostgreSQL calculates all money under the locked account boundary.
- The immutable snapshot stores opening balance, verified deposits, Manual Deposits,
  withdrawals, positive corrections, negative corrections and signed reversal net
  separately. Calculated balance is the signed ledger total at the closing boundary.
- The Cashier supplies the actual bank balance. PostgreSQL derives `difference` as
  actual minus calculated; any non-zero result requires a bounded explanation.
- Draft creation uses a UUID identity/idempotency key. Exact replay returns the same
  snapshot; changed reuse conflicts. Account/date sequence numbers remain unique.
- Submission follows `DRAFT -> SUBMITTED -> MATCHED|DISCREPANCY` in one transaction.
  A zero difference becomes `MATCHED`; any non-zero difference becomes
  `DISCREPANCY`. Repeated submission returns the existing result.
- Create and submit each write sanitized audit evidence. Every status transition is
  also appended to immutable reconciliation history.
- Financial snapshot fields cannot be changed or deleted. A database trigger allows
  only explicit workflow transitions and future Manager decision metadata.
- Bounded list and detail APIs enforce business/branch visibility. Detail returns
  sanitized chronological status history without audit IDs or role-assignment IDs.
- Migrations `023_v2_daily_reconciliation_workflow.sql` and
  `024_v2_reconciliation_created_at.sql` provide the workflow guard, history,
  idempotency, reversal category, decision fields and complete snapshot provenance.

Validation evidence:

- [x] Focused reconciliation validation passes: 1 suite and 9 tests.
- [x] Full unit regression passes: 71 suites and 375 tests.
- [x] Database-backed V2 regression passes: 1 suite and 17 tests.
- [x] PostgreSQL acceptance proves separate Manual Deposit and withdrawal totals,
      calculated-balance equality, exact replay, `MATCHED` and `DISCREPANCY`
      classification, three-step status history and snapshot mutation rejection.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] Migrations `001` through `026` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Increment 2 - Manager decision and returned-draft replacement

Implemented:

- An active Manager assigned to the exact branch can decide a `MATCHED` or
  `DISCREPANCY` reconciliation through `POST .../:reconciliationId/decision`.
- Every `APPROVED` or `RETURNED` decision requires a trimmed reason of 10-1000
  characters and records the deciding role assignment and decision timestamp.
- Identical repeated decisions are safe replays. A changed reason, opposite decision,
  or decision against any other state conflicts without changing data.
- List queries accept an allow-listed `status` filter for Manager work queues.
- Manager decisions commit the snapshot transition, sanitized audit record and
  immutable status-history row in one database transaction.
- When a Cashier creates a replacement for the same account/date after a return, the
  returned snapshot transitions to `SUPERSEDED`; both records and their histories
  remain available.
- Migration `025_v2_reconciliation_manager_decisions.sql` prevents direct or later
  mutation of decision metadata. Migration `026_v2_reconciliation_history_order.sql`
  adds a positive per-snapshot transition number so history order is deterministic
  even when multiple transitions share PostgreSQL's transaction timestamp.

Validation evidence:

- [x] Exact-branch Manager authorization and decision error mapping pass unit tests.
- [x] PostgreSQL acceptance proves approve, return, exact replay, status queue,
      replacement supersession, audit persistence and chronological history.
- [x] Direct financial-snapshot and decision-metadata mutations are rejected.
- [x] Full unit regression passes: 71 suites and 375 tests.
- [x] V2 database integration regression passes: 1 suite and 17 tests.
- [x] Strict source/test lint and production TypeScript build pass.
- [x] No dependency or lockfile changes.

## Next increment

- Begin Phase 7 branch credit-wallet and credit-lot lifecycle implementation.
