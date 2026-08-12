# PayGuard Backend

Node.js/NestJS modular monolith for PayGuard's multi-tenant fintech platform.
PostgreSQL is the transactional system of record; Redis and BullMQ support queues,
short-lived locks/status, rate limiting and background processing.

## Product responsibilities

- Authentication, sessions, RBAC and business/branch isolation
- Businesses, branches, users and audited staff removal
- Banks and branch settlement accounts
- Platform subscription settlement accounts
- Document/image QR extraction and bank detection
- Verify.ET adapters, webhooks, polling, retry and monitoring
- Payment verification, duplicate prevention and pending rechecks
- Branch credits, expiry and deferred subscription deductions
- Monthly subscriptions, proof verification, activation and invoices
- Immutable ledger, Manual Deposits and reconciliation
- Fraud locks, recovery codes, notifications, reports, audit and archive

Clients never call Verify.ET directly and never receive its keys or unrestricted
provider debug data.

## Documentation

- `docs/ARCHITECTURE.md` - backend structure, modules, data and processing flows
- `docs/PROJECT-PLAN.md` - implementation phases and exit conditions
- `docs/MODULE-IMPLEMENTATION-CHECKLIST.md` - build tasks and expected result per module
- `docs/TEST-IMPLEMENTATION-CHECKLIST.md` - backend test plan and release checks
- `docs/PHASE-5-LEDGER-VALIDATION.md` - Phase 5 immutable-ledger increments and evidence
- `docs/PHASE-6-RECONCILIATION-VALIDATION.md` - Phase 6 daily reconciliation evidence
- `docs/PHASE-7-CREDITS-VALIDATION.md` - Phase 7 branch credit-lot evidence
- `docs/PHASE-1-VALIDATION.md` - current implementation evidence and blocked checks
- `docs/PHASE-2-VALIDATION.md` - core business setup implementation/test evidence
- `docs/V2-CUTOVER-RUNBOOK.md` - guarded production preflight, backup rehearsal,
  cutover and rollback procedure
- `docs/MIGRATIONS.md` - versioned migration, checksum and rollback workflow
- `docs/API-DOCUMENTATION.md` - Swagger, OpenAPI and Postman contract workflow
- `database/initial/README.md` - standalone Version 2.0 empty-database baseline
- `postman/README.md` - import and use the generated complete API collection
- `../docs/SOURCE-OF-TRUTH.md` - scope authority and cross-project boundaries

## Local development

1. Copy `.env.example` to `.env` and replace placeholder secrets.
2. Start PostgreSQL, Redis and MinIO with `docker compose up -d`.
3. Run `npm install`.
4. Run `npm run migration:up:dev`.
5. Start the API with `npm run start:dev`.
6. Start workers separately with `npm run start:worker:dev`.

`DATABASE_SCHEMA_VERSION` defaults to `legacy`. Enable `v2` only with a V2 database
that has every migration shown as applied by `npm run migration:v2:status:dev` and
after completing the gates in `docs/V2-BACKEND-CUTOVER.md`.

The isolated V2 PostgreSQL acceptance suite is run with
`npm run test:v2:integration`; it requires `TEST_V2_DATABASE_URL` to target a
disposable database whose name ends in `_test`.

Create every future schema change through the migration generator:

```powershell
npm run migration:create -- descriptive_change_name
npm run migration:status:dev
npm run migration:up:dev
```

Never edit an applied migration. The runner verifies SHA-256 checksums and blocks
rollback when a reviewed `.down.sql` file is absent.

Endpoints:

- `GET /health/live` - process liveness
- `GET /health/ready` - PostgreSQL, Redis and object-storage readiness
- `GET /metrics` - Prometheus-compatible metrics
- `GET /docs` - interactive Swagger UI
- `GET /docs-json` - generated OpenAPI JSON
- `GET /docs-yaml` - generated OpenAPI YAML
- `GET /docs/postman.json` - generated Postman collection containing every API
- `/api/v1/auth/*` - login, refresh, logout and current principal
- `/api/v1/businesses/*` - registration, review and Owner-scoped business setup
- `/api/v1/businesses/:businessId/branches/*` - branches, staff and accounts
- `/api/v1/banks` - enabled-bank catalog and Super Admin lifecycle
- `/api/v1/platform/subscription-settlement-accounts` - Platform account lifecycle
- `GET /api/v1/subscription-plans` - active subscription plan catalog
- `/api/v1/businesses/:businessId/branches/:branchId/subscription-purchases` -
  Owner purchase, scoped history/detail and protected payment-proof intake
- `POST .../subscription-purchases/:purchaseId/verify` - idempotent proof matching,
  Verify.ET processing and verified-only atomic subscription credit activation
- Verified purchase details include the immutable subscription invoice; invoices are
  never issued for pending, failed, mismatched or duplicate payments.

## Validation

```powershell
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm run test:api-docs
npm run docs:check
```

Integration tests require `TEST_DATABASE_URL` pointing to a disposable PostgreSQL
database. CI provisions this database automatically.
