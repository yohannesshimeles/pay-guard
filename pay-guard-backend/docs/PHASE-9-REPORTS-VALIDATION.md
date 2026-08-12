# Phase 9 Reports Validation

## Increment 1 - Scoped financial summary

Implemented:

- `GET /api/v1/businesses/:businessId/reports/financial-summary` accepts a required,
  inclusive date range plus optional branch and settlement-account filters;
- the maximum synchronous report window is 366 days to keep request cost bounded;
- Primary Owners, Additional Owners and legacy Business Owners may report across their
  business or select one branch;
- Managers and Cashiers are forcibly restricted to their authenticated branch, and a
  query parameter cannot broaden or replace that scope;
- Waiters, Platform Admin identities and users outside the requested business are
  rejected;
- PostgreSQL calculates entry count, credit, debit and net totals directly from the
  immutable ledger source;
- results retain separate `OPENING_BALANCE`, `VERIFIED_DEPOSIT`, `MANUAL_DEPOSIT`,
  `WITHDRAWAL`, correction and reversal categories;
- migration `042_v2_financial_report_index.sql` adds the business/branch/date/type
  access path used by the summary.

Validation:

- focused service tests cover business membership, role, branch override and bounded
  date-range authorization;
- focused DAO tests prove business/branch predicates, read-only SQL and distinct Manual
  Deposit and verified-payment categories;
- an authenticated PostgreSQL HTTP integration case proves a Manager receives only the
  selected branch summary and cannot override its branch;
- the clean V2 integration setup includes migration 042;
- all 24 V2 PostgreSQL integration tests pass.

Remaining Phase 9 reports work:

- verification, credit, subscription, provider and fraud report views;
- asynchronous export jobs, generated files, download authorization and expiry;
- report reconciliation, cross-scope export and load validation.

## Increment 2 - Operational and provider summaries

Implemented:

- `GET /api/v1/businesses/:businessId/reports/operational-summary` aggregates scoped
  verification statuses, branch credit wallets, subscription order/invoice outcomes,
  fraud attempts, open flags and purchase locks;
- Primary Owners and Additional Owners may query their business or one branch, while
  Managers and Cashiers are forcibly restricted to their authenticated branch;
- the business report reads only categorized outcomes and never returns provider
  snapshots, transaction references, account data or proof evidence;
- `GET /api/v1/platform/reports/provider-summary` aggregates Verify.ET request status,
  operation counts, HTTP response classes, average response time and sanitized incident
  counts;
- provider health is global and therefore requires an authenticated Platform Super
  Admin identity; business identities are rejected even if they forge a role string;
- business operational ranges are bounded to 366 days and provider-health ranges to
  93 days;
- migration `043_v2_operational_report_indexes.sql` adds report access paths without
  changing operational records.

Validation:

- unit tests cover business, role, branch and Platform identity boundaries, bounded
  ranges, response mapping and sensitive-column exclusion;
- authenticated HTTP/PostgreSQL integration proves Manager branch isolation, denies
  Manager provider access and permits the Platform Super Admin provider report;
- clean V2 database setup applies migrations 001-043;
- all 25 V2 PostgreSQL integration tests pass.

Remaining Phase 9 reports work:

- asynchronous export request, worker, file and authorized download lifecycle;
- report/export reconciliation, cross-scope attack and load validation.

## Increment 3 - Asynchronous exports and protected downloads

Implemented:

- `POST /api/v1/businesses/:businessId/reports/exports` creates an idempotent durable
  `FINANCIAL_SUMMARY` or `OPERATIONAL_SUMMARY` CSV job;
- the immutable job records exact business, selected branch, requester, role, report
  type, bounded dates and supported filters;
- any selected branch context is enforced for Owners, Managers and Cashiers; only an
  Owner using a main-business context may request a business-wide export;
- a lease-based PostgreSQL worker safely reclaims abandoned processing jobs, retries
  bounded failures three times and exposes only a sanitized failure code;
- export contents are generated from the same scoped PostgreSQL DAOs as synchronous
  reports, preventing dashboard/export total drift;
- CSV values are quoted and spreadsheet-formula prefixes are neutralized;
- generated files use private object keys, server-side storage encryption, SHA-256
  integrity metadata and 30-day availability;
- status and download routes require the exact requesting user and business; storage
  object keys are never returned;
- successful downloads are recorded, expired files become inaccessible and the worker
  removes their stored objects.

Endpoints:

- `POST /api/v1/businesses/:businessId/reports/exports`;
- `GET /api/v1/businesses/:businessId/reports/exports/:jobId`;
- `GET /api/v1/businesses/:businessId/reports/exports/:jobId/download`.

Validation:

- service tests validate immutable branch scope, filter/range policy, idempotency
  conflict detection, requester-only lookup and protected download behavior;
- worker tests validate private generation, checksum, retry, expiry, compensation and
  CSV injection protection;
- authenticated PostgreSQL integration validates request persistence, exact replay,
  cross-branch denial, lease claim, completion and requester status retrieval;
- clean V2 database setup applies migrations 001-044;
- all 26 V2 PostgreSQL integration tests pass.

Remaining Phase 9 Reports completion gate:

- production-sized report/export load testing and threshold approval.
