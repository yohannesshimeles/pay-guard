# Phase 9 Audit Validation

## Increment 1 - immutable, safe and scoped audit access

Implemented:

- migration `045_v2_audit_query_foundation.sql` for correlation constraints and
  business/branch, record and correlation query indexes;
- correlation-aware V2 audit writes and compatibility repair for the legacy writer;
- recursive secret-key, bearer credential and JWT-shaped value redaction;
- bounded before/after metadata and free-text audit fields;
- `GET /api/v1/businesses/:businessId/audit-logs` for Owner/Manager investigations;
- `GET /api/v1/platform/audit-logs` for isolated Platform Super Admin investigations;
- action, record, result, date, business/branch and bounded pagination filters.

Authorization behavior:

- Owners may inspect only explicitly linked business records.
- Managers require a selected branch and cannot override it through query parameters.
- Business users cannot call the platform endpoint.
- Platform identities cannot call the business endpoint.

Validation result (2026-08-13):

- lint: pass;
- Nest build: pass;
- unit: 94 suites, 454 tests passed;
- V2 PostgreSQL integration: 1 suite, 27 tests passed;
- development migration status: migration 045 applied;
- immutable update/delete behavior: SQLSTATE 55000 verified;
- generated OpenAPI/Postman freshness check: pass;
- production dependency audit: 0 vulnerabilities after the compatible Nest Fastify,
  Fastify Static and transitive advisory remediation.

Remaining Audit work:

- produce the source-document-to-action coverage matrix;
- instrument any sensitive commands identified as missing from that matrix;
- validate deliberate failure-event coverage and the complete application-wide leakage scan.

## Increment 2 - authenticated sensitive-action coverage

Added atomic audit events for:

- transaction submission;
- transaction proof persistence;
- report export request and download;
- notification preference before/after changes;
- notification device registration and deactivation.

The source-to-event inventory is maintained in
`PHASE-9-AUDIT-COVERAGE-MATRIX.md`. PostgreSQL integration verifies all seven
new action types and confirms that idempotent source replays do not duplicate
transaction/report request events. Remaining gaps are explicitly limited to
background system lifecycle events and future endpoints/modules.
