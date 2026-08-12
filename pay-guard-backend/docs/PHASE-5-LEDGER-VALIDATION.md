# Phase 5 Ledger Validation

Status: Increments 1-5 implemented

## Increment 1 - Central immutable posting foundation

Implemented:

- The existing V2 `settlement_accounts` records remain the operational ledger
  accounts, preserving the approved database design and existing verified-payment
  history.
- Central `LedgerDao` and `LedgerPostingService` boundaries now own new ledger
  posting and reversal operations through `CentralDao.transaction`.
- Account scope and active status are checked while the settlement account row is
  locked. Balance update and immutable entry insertion commit or roll back together.
- Credit entries increase and debit entries decrease the stored calculated balance;
  every entry stores the resulting running balance.
- Supported entry types are opening balance, verified deposit, manual deposit,
  withdrawal, positive correction, negative correction and reversal.
- A business-scoped idempotency key accepts an exact replay and rejects changed reuse.
  Account locking serializes concurrent posts so identical concurrent requests create
  one balance effect and one entry.
- A reversal copies the exact original amount, uses the opposite direction and links
  to the immutable original entry. A unique database index permits one reversal per
  original entry.
- Every new centralized posting requires an audit-log ID and retains business,
  branch, settlement account, effective time, source record, creator, work assignment,
  reason/description and idempotency metadata.
- Existing mutation-prevention triggers continue to reject ledger update and delete.
- Migration `019_v2_ledger_posting_foundation.sql` adds reversal, audit and idempotency
  constraints and indexes without rewriting historical entries.

Validation evidence:

- [x] Focused ledger DAO/service validation passes: 2 suites and 7 tests.
- [x] Full unit regression passes: 63 suites and 335 tests.
- [x] Database-backed V2 regression passes: 1 suite and 13 tests.
- [x] PostgreSQL validation proves concurrent exact replay posts once, deposit and
      withdrawal effects use the correct direction, reversal compensates without
      changing the original, audit IDs are retained and direct mutation is rejected.
- [x] Strict source and test lint pass with zero warnings.
- [x] Production build passes.
- [x] Migrations `001` through `019` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Route verified-payment posting through the central ledger boundary and implement
  authenticated branch-scoped ledger list/detail and projected-balance queries.

## Increment 2 - Verified-payment cutover and scoped ledger queries

Implemented:

- Verified-payment confirmation now creates a sanitized system audit event and calls
  `LedgerDao.postWithin` in the existing verification database transaction.
- Confirmation, audit, row-locked balance update, immutable ledger entry, transaction
  ledger link and final verification transition commit or roll back together.
- Verified entries use `ledger:verified:<confirmationId>` idempotency and retain the
  audit-log link required by the Phase 5 financial boundary.
- `GET /api/v1/businesses/:businessId/ledger` returns a bounded ledger page with
  allow-listed branch, account, entry-type and inclusive date filters.
- `GET /api/v1/businesses/:businessId/ledger/:entryId` returns one visible immutable
  entry or not found for an inaccessible entry.
- `GET /api/v1/businesses/:businessId/ledger/accounts/:accountId/projected-balance`
  returns the current and read-only projected ETB balance for a validated credit or
  debit amount; it does not reserve or post funds.
- Owners are business-scoped. Managers and Cashiers require their selected branch and
  cannot override it. Waiters and Platform Super Admin identities are denied.
- API projections exclude source-record IDs, audit-log IDs, idempotency keys and other
  internal linkage metadata.
- Existing migration `019` already supports the centralized verified entry and safe
  queries, so no new migration was required.

Validation evidence:

- [x] Focused ledger-query and verified-posting validation passes: 3 suites and
      13 tests.
- [x] Full unit regression passes: 65 suites and 342 tests.
- [x] Database-backed V2 regression passes: 1 suite and 13 tests.
- [x] PostgreSQL validation proves verified entries contain central audit and
      idempotency metadata and authenticated Manager list/detail/projection endpoints
      remain branch-scoped and safe.
- [x] Strict source and test lint pass with zero warnings.
- [x] Production build passes.
- [x] Migrations `001` through `019` remain applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Implement Cashier withdrawal with projected-balance confirmation and insufficient-
  balance protection, followed by Manager correction/reversal approval.

## Increment 3 - Cashier Manual Deposit intake

Implemented:

- `POST /api/v1/businesses/:businessId/branches/:branchId/manual-deposits`
  requires an authenticated, active Cashier membership, role and work assignment for
  the exact business and branch. The DAO repeats those checks against PostgreSQL.
- Inputs require a UUID idempotency key, positive canonical two-decimal ETB amount,
  bounded description, valid timestamp and exact current/projected balance
  confirmation. Future transaction timestamps are rejected.
- The idempotency UUID is also the immutable deposit identity. The account row is
  locked before replay evaluation, so concurrent exact submissions serialize into
  one deposit, one audit record, one credit entry and one balance effect. Changed
  reuse returns conflict.
- Stale balance confirmation returns conflict and requires the client to refresh
  `GET .../ledger/accounts/:accountId/projected-balance?direction=CREDIT&amount=...`.
- Audit insertion, central `MANUAL_DEPOSIT` ledger credit, running-balance update and
  deposit insertion share one `CentralDao` transaction.
- Bounded list and detail endpoints enforce business and branch visibility and expose
  no storage key, SHA-256 hash, audit ID or idempotency metadata.
- Optional `attachment` multipart upload accepts only validated JPEG, PNG or PDF up
  to 10 MiB, verifies signature/extension, fails closed on malware scan, writes to a
  server-generated private object key and compensates storage if metadata persistence
  fails. Only the originating Cashier role assignment can attach one immutable file.
- Migration `020_v2_manual_deposit_intake.sql` adds deposit idempotency/indexing and
  the immutable protected attachment metadata table.

Validation evidence:

- [x] Focused Manual Deposit validation passes: 2 suites and 8 tests.
- [x] Full unit regression passes: 67 suites and 350 tests.
- [x] Database-backed V2 regression passes: 1 suite and 14 tests.
- [x] The HTTP integration test proves exact replay creates one ledger row and one
      audit row, increases the projected balance once, performs no Verify.ET request
      and consumes no credit.
- [x] Strict source and test lint pass with zero warnings.
- [x] Production TypeScript build passes.
- [x] Migrations `001` through `020` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.
- [ ] Fresh dependency audit could not be queried because this execution environment
      blocks the npm audit endpoint. The immediately preceding production audit in
      this project reported zero vulnerabilities and dependencies were unchanged.

## Increment 4 - Cashier withdrawals

Implemented:

- `POST /api/v1/businesses/:businessId/branches/:branchId/withdrawals` requires
  an authenticated active Cashier in the exact business, branch, membership role and
  work assignment. PostgreSQL repeats the scope validation while locking the account.
- Requests require a UUID idempotency key, canonical positive two-decimal ETB amount,
  recipient name, recipient bank, bounded reason/description, non-future timestamp,
  and exact current/projected balance confirmation.
- The account lock serializes the balance check and debit. A withdrawal that would
  make the calculated settlement balance negative is rejected before any audit,
  balance, ledger or withdrawal row is written.
- Audit insertion, central `WITHDRAWAL` ledger debit, running-balance update and
  immutable withdrawal insertion commit or roll back in one `CentralDao` transaction.
- The idempotency UUID is the immutable withdrawal identity. Exact replay returns the
  original result without another debit; changed reuse returns conflict.
- Bounded list and detail endpoints enforce business/branch visibility and omit audit
  IDs, work-assignment IDs and idempotency metadata.
- Migration `021_v2_cashier_withdrawals.sql` adds business-scoped replay protection
  and branch/effective-time query indexing without rewriting historical withdrawals.

Validation evidence:

- [x] Focused withdrawal validation passes: 1 suite and 6 tests.
- [x] Full unit regression passes: 68 suites and 356 tests.
- [x] Database-backed V2 regression passes: 1 suite and 15 tests.
- [x] HTTP/PostgreSQL validation proves one debit, one withdrawal and one audit row,
      exact replay, changed replay conflict, overdraft rejection, scoped list/detail
      and direct withdrawal mutation rejection.
- [x] Strict source and test lint pass with zero warnings.
- [x] Production TypeScript build passes.
- [x] Migrations `001` through `021` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Implement Manager correction and compensating reversal approval with mandatory
  reasons, branch scope, evidence policy, dual immutable linkage and atomic audit.

## Increment 5 - Manager corrections and compensating reversal approvals

Implemented:

- `POST /api/v1/businesses/:businessId/branches/:branchId/corrections` requires an
  active Manager membership, role and work assignment for the exact branch; the DAO
  repeats that authorization while locking the settlement account.
- Positive and negative corrections require canonical ETB amount, a meaningful
  10-1000 character reason, non-future effective timestamp, UUID idempotency key and
  exact current/projected balance confirmation.
- An optional reconciliation ID is accepted only when its business, branch and
  settlement account match the correction scope. This preserves an evidence link
  without exposing or trusting cross-tenant records.
- Negative corrections that would overdraw the settlement account are rejected
  before any audit, ledger, balance or correction write.
- Correction audit, central positive/negative ledger posting, account update and
  immutable correction source row share one PostgreSQL transaction. Exact replay has
  one financial effect; changed reuse conflicts.
- Correction list/detail endpoints are bounded and business/branch scoped.
- `POST .../ledger/:entryId/reversal-approvals` lets an active branch Manager approve
  one compensating reversal of a visible non-reversal ledger entry. It derives the
  exact original amount and opposite direction under row locks; callers cannot choose
  either financial value.
- A reversal of a credit is blocked if its compensating debit would overdraw the
  account. Every approval requires exact balance confirmation and a meaningful reason.
- Original entry, reversal entry and explicit approval row remain separately
  immutable. Unique constraints allow only one reversal per original entry.
- Migration `022_v2_manager_financial_controls.sql` corrects the historical actor
  column name, adds correction replay/query indexes and creates immutable reversal
  approval records linked to both ledger entries and their audit event.

Validation evidence:

- [x] Focused Manager financial-control validation passes: 2 suites and 10 tests.
- [x] Full unit regression passes: 70 suites and 366 tests.
- [x] Database-backed V2 regression passes: 1 suite and 16 tests.
- [x] HTTP/PostgreSQL validation proves a correction posts once, exact replay has no
      second effect, a derived opposite reversal restores the exact prior balance,
      a second approval conflicts and overdraft corrections are rejected.
- [x] PostgreSQL rejects mutation of the original correction and deletion of its
      reversal approval; audit, correction, reversal and approval cardinalities are
      each validated.
- [x] Strict source and test lint pass with zero warnings.
- [x] Production TypeScript build passes.
- [x] Migrations `001` through `022` are applied to local `payguard_v2`.
- [x] No dependency or lockfile changes.

## Next increment

- Implement daily reconciliation totals and workflow states using the completed
  immutable opening, verified, Manual Deposit, withdrawal and correction categories.
