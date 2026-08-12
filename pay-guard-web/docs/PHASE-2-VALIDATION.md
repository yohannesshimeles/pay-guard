# Web Phase 2 Implementation and Validation

Validated: July 29, 2026

## Implemented vertical slices

- [x] Public business and owner registration with pending-review result.
- [x] Platform business application list and activate/suspend/reject actions.
- [x] Owner explicit business and branch scope on every setup request.
- [x] Branch list, creation and selected-branch update.
- [x] Manager, Cashier and Waiter creation with protected temporary passwords.
- [x] Staff removal confirmation with mandatory reason.
- [x] Clear warning that sessions/devices are revoked while audit history remains.
- [x] Removed-staff historical display using the authorized backend flag.
- [x] Enabled-bank list and branch settlement-account creation.
- [x] Masked-only account list and explicit deactivation.
- [x] Scoped query invalidation after every successful mutation.
- [x] Restricted server-side gateway allowlist; arbitrary paths and SSRF-style values
  are rejected before a backend request.

## Validation evidence

- ESLint: passed with zero warnings.
- TypeScript strict check: passed.
- Unit/component/security/accessibility: 31 tests passed.
- Gateway allowlist: 10 allowed contract paths and 5 rejected paths passed.
- Production build: passed, generating all 20 application/API routes.
- Desktop and mobile Chrome: all 18 browser cases reached passing state.

## Backend-enforced controls exercised by the UI

- Cross-business and cross-branch authorization remains authoritative in the backend.
- Suspended businesses cannot create branches, staff or settlement accounts.
- Final active Manager removal is rejected.
- Removal revokes active sessions and devices.
- Disabled banks cannot be selected.
- Full account values are encrypted by the backend and never returned to the web UI.
- One active settlement account per branch/bank conflict is shown safely.

## Deferred contract-dependent views

The current backend does not expose separate read contracts for business status
history, invitation lifecycle, staff device/last-login details, or settlement-account
ledger/activity. The web does not fabricate these records. They remain unchecked
until those backend endpoints are added in a later API expansion.
