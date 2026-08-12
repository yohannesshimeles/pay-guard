# Web Test Implementation Checklist

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## Test foundation

- [x] Configure unit/component tests, Testing Library, API mocks and browser E2E.
- [x] Seed mocked sessions for Super Admin, Owner, Manager and Cashier.
- [x] Seed two business identifiers to test cache isolation and Owner switching.
- [x] Add automated accessibility checks and desktop/mobile checks for core states.
- [x] Test the production build, not only development mode.

## Routing and authorization

- [x] Each role has its own PDF-defined navigation foundation.
- [x] Direct cross-role route entry renders access denied.
- [x] Owner business and branch switchers invalidate prior scoped data.
- [x] Manager and Cashier remain fixed to their assigned branch.
- [ ] Removed user session immediately returns to authentication.
- [ ] IDs, filters and export requests never render cross-business records.

## Platform Super Admin

- [ ] Subscription settlement account create, mask, activate/deactivate, rotate, default and accepted-plan controls.
- [ ] Disabled banks cannot be selected.
- [ ] Historical subscription payments retain original account reference.
- [ ] Verify.ET/provider credit, errors, availability, retry, webhook and queue states.
- [ ] Fraud duplicate/suspicious/purchase-lock/recovery decision views.
- [ ] Audit and one-year archive/retrieval screens.

## Business Owner

- [ ] Multi-business and branch-context behavior on every branch-scoped feature.
- [ ] Staff removal requires reason and explicit confirmation.
- [ ] Final required Manager dependency blocks removal until replacement.
- [ ] Removal success shows access revocation and preserved history.
- [ ] Removed users disappear from normal list but remain in authorized history/audit.
- [ ] Settlement account uniqueness conflict and masked values.
- [ ] Exactly three plans and correct credits/prices/one-month expiry/no top-up.

## Subscription proof

- [ ] JPG, JPEG, PNG and PDF upload, preview, size/type errors.
- [ ] Uploading, reading, searching, found, no QR, multiple QR and unsupported states.
- [ ] Camera permission, stable capture, flash/focus/retake/cancel/switch-to-upload.
- [ ] Owner is not asked to type decoded bank-specific values.
- [ ] API queued/running, pending, verified, amount mismatch, wrong receiver, duplicate,
  suspected fraud, bank unavailable and provider unavailable states.
- [ ] Activation displays credit grant, one-credit deduction, final balance and invoice.
- [ ] Zero-credit final balances display 9,999 / 19,999 / 29,999.

## Manager and Cashier operations

- [ ] Manual Deposit validates account, positive ETB, description, date/time and attachment.
- [ ] Projected balance appears before confirmation.
- [ ] Success/history show all PDF-required columns and audit timeline.
- [ ] No edit/delete action exists for posted Manual Deposit.
- [ ] Manager can flag and create linked correction only.
- [ ] Pending verification is yellow and has no Manager approval.
- [ ] Reconciliation shows Manual Deposits separately and all required components/states.
- [ ] Withdrawals, corrections and reversals show backend balance effects.

## Error, accessibility and security

- [x] Shared loading, empty, validation, permission, network and retry states exist.
- [x] Status never relies on color alone.
- [x] Keyboard, focus, form-error and table semantics checks pass.
- [ ] Browser logs/telemetry contain no passwords, full accounts, keys or raw proof.
- [ ] Proof preview cannot execute active document content.
- [ ] Repeat clicks retain idempotency key and do not show false success.
- [ ] Session expiry preserves no sensitive account/proof state.

## Critical browser E2E

- [ ] Owner removes Waiter and historical transaction links remain visible.
- [ ] Cashier Manual Deposit increases backend balance with no credit/provider event.
- [ ] Manager corrects Manual Deposit through a linked adjustment.
- [ ] Reconciliation includes Manual Deposit in expected closing balance.
- [ ] Subscription success with available branch credit.
- [ ] Subscription success from zero credits with deferred deduction.
- [ ] Amount mismatch grants no plan credits.
- [ ] Same-day proof reuse is duplicate; later-day reuse is suspected fraud.
- [ ] Duplicate webhook/backend event never appears as duplicate UI credit/ledger effect.
- [ ] Report/export and archive retrieval respect role and scope.
