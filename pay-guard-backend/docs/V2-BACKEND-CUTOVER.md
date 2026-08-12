# V2 Backend Cutover

The Version 2 database is validated separately from the currently running legacy
backend database. Do not point the production API at the V2 database until every
cutover gate below passes.

## Increment 1: identity and authorization contexts

Status: implemented and unit tested.

- `V2AuthRepository` resolves Platform Super Admin identity from `platform_admin`.
- Business identity is resolved from `users` by email or phone number.
- Active authorization contexts are read from `business_user_memberships`,
  `membership_role_assignments`, and `user_work_assignments`.
- Only active businesses, memberships, roles, and work assignments are exposed.
- Multiple businesses, roles, and branch/Main Business contexts are preserved.
- The repository is routed through the authentication facade only when the explicit
  V2 schema mode is enabled.

No migration was required for this increment because all queried structures are in
the V2 baseline.

## Increment 2: business tenancy boundary

Status: implemented and validated.

- Public business registration writes the V2 `users`, `businesses`,
  `business_user_memberships`, and Primary Owner role-assignment records in one
  transaction.
- Registration validates active business categories and requires custom category
  text when the selected category is `Other`.
- Business listing is tenant-scoped to the authenticated principal; only the
  Platform Super Admin can list across tenants.
- Platform Super Admin review activates the pending Primary Owner membership and
  role assignment atomically with the business.
- Business lifecycle changes and V2 audit records share the same transaction.
- Existing V2 sessions become invalid when their business is no longer active.
- Legacy business behavior remains the default and V2 routing requires
  `DATABASE_SCHEMA_VERSION=v2`.

No migration was required for this increment because the V2 business and tenancy
tables are already present in the V2 baseline.

## Increment 3: branch tenancy boundary

Status: implemented and validated.

- V2 branch creation writes directly to the baseline `branches` schema and
  requires every address component defined by that schema.
- Only an authenticated active Primary or Additional Owner membership can create
  a branch; a Platform Admin cannot impersonate an Owner as `created_by`.
- Branch creation and updates require an active parent business.
- Owner and Platform Admin listings may cover the selected business, while staff
  listings are restricted to their authenticated branch context.
- Cross-business identifiers are rejected before branch lookup or mutation.
- Branch create/update audit entries are committed atomically and carry explicit
  business and branch scope.
- Legacy branch behavior remains the default and V2 routing requires
  `DATABASE_SCHEMA_VERSION=v2`.

No migration was required for this increment because the V2 branch structure is
already present in the V2 baseline.

## Increment 4: staff authorization lifecycle

Status: implemented and validated.

- V2 staff creation atomically creates the user identity, active business
  membership, role assignment, and branch work assignment.
- Primary and Additional Owners are revalidated against the database before their
  membership and role identifiers are used as approval provenance.
- Platform Admin creation remains possible without fabricating business-member
  approval identifiers.
- Staff reads bind both business and branch identifiers and optionally expose
  removed assignment history to authorized Owner/Admin callers.
- Removal is scoped to the selected branch assignment; it does not globally delete
  the user or break memberships in other businesses.
- Role and membership records close only when no active downstream scope remains.
- Active sessions tied to the removed work assignment are revoked immediately.
- The final active Manager protection is enforced per branch.
- Staff create/remove audit entries share the same transaction and carry explicit
  business and branch scope.
- Legacy staff behavior remains the default and V2 routing requires
  `DATABASE_SCHEMA_VERSION=v2`.

No migration was required for this increment because V2 memberships, role
assignments, work assignments, and sessions already support this lifecycle.

## Increment 5: banks and settlement accounts

Status: implemented and validated.

- Supported-bank listing, creation, and activation status now use the V2
  `supported_banks` model and preserve Platform Admin-only mutations.
- Business settlement accounts require an exact active Owner membership and an
  assignable branch inside the selected active business.
- Account values are encrypted with AES-256-GCM into a versioned binary envelope;
  only masks and normalized suffixes are returned by the API.
- A keyed HMAC-SHA-256 fingerprint supplies deterministic duplicate detection
  without persisting the normalized plaintext account value.
- The V2 database trigger enforces fingerprint uniqueness across both business
  and platform settlement-account tables.
- Account creation, bank changes, and account deactivation are committed
  atomically with their V2 audit records.
- Platform account operations follow the V2 schema; legacy-only default-account
  and accepted-plan fields are explicitly rejected in V2 mode.
- Every business account read or mutation binds business, branch, and account
  identifiers in the database query.
- Legacy banking behavior remains the default and V2 routing requires
  `DATABASE_SCHEMA_VERSION=v2`.

No migration was required for this increment because the V2 bank tables, encrypted
account columns, global fingerprint trigger, and scope constraints already exist in
the V2 baseline.

## Remaining cutover gates

- [x] Define deterministic context selection: automatically select one active
  context, require an explicit exact selection for multiple contexts, and reject
  stale or partial membership/role/work-assignment combinations.
- [x] Add PostgreSQL storage for hashed V2 refresh tokens and separate Platform
  Super Admin sessions through `002_v2_secure_sessions.sql`.
- [x] Implement V2 session creation, revocation, expiry, refresh-token rotation,
  and active-context validation in `V2SessionRepository`.
- [x] Wire V2 identity and session repositories into login, refresh, logout, and
  access-token verification behind `DATABASE_SCHEMA_VERSION=v2`.
- [x] Keep refresh-token hashes out of logs and plaintext storage in the service
  and controller integration.
- [x] Include membership, role-assignment, and work-assignment identifiers in the
  authenticated principal and validate them on every protected request.
- [x] Add V2 audit persistence for business users and the separate Platform Super
  Admin identity through `003_v2_platform_admin_audit.sql`.
- [x] Update controlled Platform Super Admin bootstrap and password rotation for
  `platform_admin`, including audit records and active-session revocation.
- [x] Add an integration suite for V2 identity, context, refresh-token rotation,
  Waiter single-session enforcement, admin sessions, and audit persistence.
- [x] Run the V2 integration suite successfully against a disposable database
  ending in `_test` and retain the test output as cutover evidence.
- [x] Run the V2 HTTP authentication smoke test successfully: login, `/auth/me`,
  refresh-token rotation, logout, and rejection of the access token after logout.
- [x] Align business registration, tenant-scoped listing, lifecycle review, and
  audit persistence with the V2 schema.
- [x] Align branch repositories and services with the V2 tenancy model.
- [x] Align staff repositories and services with memberships, roles, and work
  assignments in the V2 schema.
- [x] Align bank and settlement-account repositories and services with the V2
  schema.
- [x] Add and pass an automated V2 preflight for migration checksums, required
  relations, validated constraints, enabled security triggers, hashed sessions,
  forbidden plaintext columns, and settlement-account tenant integrity.
- [x] Disable the generated OpenAPI document endpoint in production mode.
- [x] Document guarded backup/restore rehearsal and non-destructive application
  rollback procedures.
- [x] Run the production dependency advisory audit and confirm zero production
  vulnerabilities.
- [x] Run and retain evidence from the Docker PostgreSQL backup/restore rehearsal.
- [ ] Verify production TLS, secret-manager injection, ingress/WAF rate limiting,
  monitoring alerts, and operator approvals.
- [ ] Switch the API database URL only after unit, integration, security, and
  rollback checks pass.

The default schema mode is `legacy`. Do not set `DATABASE_SCHEMA_VERSION=v2` in the
normal backend `.env` until migrations 001-003 are applied to the selected database
and the V2 integration suite passes.

Any required schema adjustment must be introduced through a new reviewed migration;
the applied V2 baseline must never be edited in place.

## Validation evidence

On 5 August 2026, `npm run test:v2:integration` passed against
`payguard_v2_test`: 1 suite passed and all 5 tests passed. The run validated exact
active membership/role/branch lookup, atomic refresh-token rotation, Waiter
single-session enforcement, isolated Platform Super Admin sessions, and separate
business/admin audit identities.

The suite was subsequently extended with one HTTP-level authentication test. On
5 August 2026, the repeated run passed: 1 suite and all 6 tests passed in 11.534
seconds. The HTTP test covered admin login, `/auth/me`, refresh-token rotation,
logout, and rejection of the access token after logout.

The suite now contains a seventh HTTP test covering public V2 business
registration, Platform Super Admin activation, Primary Owner login, and
tenant-scoped business listing. On 5 August 2026, the extended suite passed
against `payguard_v2_test`: 1 suite and all 7 tests passed. The Nest build, lint,
and all 12 unit suites (47 tests) also passed after the activation-query fix.

The seventh end-to-end flow was then extended with V2 branch creation, update,
Owner-scoped listing, explicit Manager context selection, and cross-business access
denial. On 5 August 2026, the full integration suite again passed against
`payguard_v2_test`: 1 suite and all 7 tests passed. The Nest build, lint, and all
13 unit suites (53 tests) passed for Increment 3.

The same HTTP flow was extended with V2 staff identity/membership/role/work-scope
creation, tenant-and-branch-scoped listing, staff authentication, soft removal,
immediate access-session revocation, and authorized historical visibility. On
5 August 2026, the integration suite passed against `payguard_v2_test`: 1 suite and
all 7 tests passed. The Nest build, lint, and all 14 unit suites (59 tests) passed
for Increment 4.

The HTTP flow was extended with supported-bank discovery, encrypted business
account creation/listing/deactivation, encrypted platform account
creation/deactivation, database ciphertext inspection, and cross-table duplicate
fingerprint rejection. On 5 August 2026, the integration suite passed against
`payguard_v2_test`: 1 suite and all 7 tests passed. The Nest build, lint, and all
15 unit suites (66 tests) passed for Increment 5.

The final automated cutover preflight then passed against local `payguard_v2` on
PostgreSQL 16.14. Migrations 001-003 matched their reviewed SHA-256 checksums; all
required relations, validated constraints, and security triggers were present;
active refresh tokens were hashed; forbidden plaintext credential columns were
absent; and no settlement-account tenant violations were found. The final
regression run passed 16 unit suites (69 tests), all 7 V2 integration tests, the
Nest build, and lint. Production remains NO-GO until the external/manual gates in
`V2-CUTOVER-RUNBOOK.md` are completed.

On 5 August 2026, the guarded Docker backup/restore rehearsal completed
successfully. `payguard_v2` was dumped in PostgreSQL custom format and restored to
the isolated `payguard_v2_restore_test` database. The script verified matching
public-table and migration-history counts and retained the restore-test database
for inspection. The backup artifact is excluded from Git.

On 5 August 2026, the reviewed dependency remediation upgraded the affected
Fastify, Swagger, UUID, and OpenTelemetry dependency paths. The production-only
audit then reported zero vulnerabilities. Post-upgrade validation passed lint,
the Nest build, all 16 unit suites (69 tests), and the V2 integration suite (7
tests).

## V2 integration test

The test resets the `public` schema and therefore refuses to run unless the selected
database name ends in `_test`.

```cmd
set "ADMIN_DATABASE_URL=postgresql://payguard:payguard@127.0.0.1:55432/postgres"
set "TEST_DATABASE_NAME=payguard_v2_test"
npm run test:v2:database:prepare
set "TEST_V2_DATABASE_URL=postgresql://payguard:payguard@127.0.0.1:55432/payguard_v2_test"
npm run test:v2:integration
```

## V2 Platform Super Admin bootstrap

Run only after migrations 001-003 are applied to the target V2 database:

```cmd
set "DATABASE_URL=postgresql://payguard:payguard@127.0.0.1:55432/payguard_v2"
set "DATABASE_SCHEMA_VERSION=v2"
set "BOOTSTRAP_ADMIN_EMAIL=admin@example.test"
set "BOOTSTRAP_ADMIN_PASSWORD=choose-a-private-password-of-12-or-more-characters"
set "BOOTSTRAP_ADMIN_FULL_NAME=Platform Administrator"
set "BOOTSTRAP_ADMIN_PHONE=+251911000000"
set "BOOTSTRAP_ADMIN_JOB_TITLE=Platform Super Administrator"
npm run bootstrap:admin
set BOOTSTRAP_ADMIN_PASSWORD=
```
