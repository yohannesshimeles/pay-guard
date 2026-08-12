# Web Module Implementation Checklist

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

Each module lists what to build and the result reviewers should expect.

## Phase 1 - Web foundation

### Design system

Implementation:

- [x] Configure Tailwind CSS and semantic design tokens.
- [x] Build button, input, select, currency, date/time, upload, dialog, drawer, table,
  pagination, status, notification, timeline and feedback components.
- [x] Add keyboard focus, accessible labels and non-color status indicators.
- [x] Document loading, empty, error, disabled and validation variants.

Expected:

- [x] All four portals use one consistent component system.
- [x] Pending and all result states use icon/text as well as color.
- [x] Components work with keyboard and common responsive widths.

### API and application shell

Implementation:

- [x] Configure TanStack Query, React Hook Form and Zod.
- [x] Create typed API client for the backend envelope and correlation IDs.
- [x] Build login/session-expired/access-denied flows.
- [x] Build separate Platform, Owner, Manager and Cashier route layouts/navigation.
- [x] Add explicit Owner business/branch selectors and fixed Manager/Cashier branch context.
- [x] Add global loading, empty, offline, permission and retry states.

Expected:

- [x] Authenticated role lands in the correct portal.
- [x] Switching scope invalidates prior scoped data.
- [x] UI never treats an unconfirmed mutation as completed.

## Phase 2 - Business module

Implementation:

- [x] Build Super Admin business/application list and status actions.
- [x] Build Owner self-registration and business switcher.
- [x] Build branch list, create/edit and explicit branch switcher.
- [x] Display server authorization and conflict errors safely.

Expected:

- [x] Super Admin can operate cross-business; Owner sees linked businesses only.
- [x] Every branch setup page makes its business/branch context visible.

Completion:

- [x] Cross-business navigation, gateway allowlist and stale-cache tests pass.

## Phase 2 - Staff module

Implementation:

- [x] Build Manager, Cashier and Waiter lists.
- [x] Display role, branch and status from the current backend contract.
- [x] Build staff creation flow with temporary-password protection.
- [x] Build removal reason and explicit confirmation.
- [x] Surface the backend final-required-Manager conflict safely.
- [x] Explain immediate session/device revocation before confirmation.
- [x] Hide Removed users from normal list and support authorized historical display.

Expected:

- [x] Owner removes staff without implying that historical records are deleted.
- [x] Successful removal refreshes active staff immediately.

Completion:

- [ ] Manager/Cashier/Waiter removal journeys and history checks pass.

## Phase 2 - Settlement accounts module

Implementation:

- [x] Build Owner branch settlement-account list/add/deactivate.
- [x] Validate enabled bank, account value, selected business and branch.
- [x] Display masked values exclusively after creation.
- [x] Handle one-active-account-per-bank conflict.
- [x] Keep full values and secrets out of logs/telemetry.

Expected:

- [x] Owner configures branch receiving accounts without cross-branch leakage.
- [x] Lists consistently use masked account presentation.

## Phase 3 - Verification module

Implementation:

- [ ] Build scoped live, history, pending, failed and duplicate lists.
- [ ] Build verification detail, matching result and status timeline.
- [ ] Render queued, running, pending, verified, failed, duplicate, amount mismatch,
  account mismatch, bank unavailable, provider unavailable and credits exhausted.
- [ ] Poll/stream the same verification ID during pending.
- [ ] Remove Manager approval action while provider status is pending.

Expected:

- [ ] Roles receive only authorized verification details.
- [ ] Pending is visibly yellow and automatically updates.
- [ ] Duplicate is never displayed as a new successful payment.

## Phase 4 - Cashier Manual Deposit module

Implementation:

- [ ] Build form for active branch settlement account, ETB amount, description,
  effective date/time, optional note and attachment.
- [ ] Enforce positive precision, required fields and future-date policy.
- [ ] Display backend current and projected balances before confirmation.
- [ ] Require confirmation and idempotent submission.
- [ ] Build success detail and history with all PDF-required columns.
- [ ] Omit edit/delete controls for posted entries.

Expected:

- [ ] Successful entry displays immutable `MANUAL_DEPOSIT` and audit reference.
- [ ] UI does not show provider processing or credit deduction.

Completion:

- [ ] Validation, repeat-submit, history and projected-balance E2E tests pass.

## Phase 4 - Manager Manual Deposit review module

Implementation:

- [ ] Build assigned-branch review list/detail.
- [ ] Display amount, description, effective time, account and creator.
- [ ] Build flag action and linked correction workflow.
- [ ] Display original and correction without editing the original.

Expected:

- [ ] Manager reviews/corrects; original remains immutable and separately reported.

## Phase 4 - Financial operations module

Implementation:

- [ ] Build Cashier withdrawal forms and history.
- [ ] Build Manager correction and reversal workflows.
- [ ] Show backend-calculated balance impact before confirmation.
- [ ] Capture required reasons/evidence and display audit timeline.

Expected:

- [ ] Users understand the immutable adjustment before submitting.
- [ ] No client-side arithmetic becomes the authoritative balance.

## Phase 4 - Reconciliation module

Implementation:

- [ ] Display opening, verified, Manual Deposit, withdrawal and
  correction categories.
- [ ] Display expected, Cashier-confirmed and difference values.
- [ ] Build Cashier draft/submit and Manager approve/return actions.
- [ ] Render DRAFT, SUBMITTED, MATCHED, DISCREPANCY, APPROVED and RETURNED.

Expected:

- [ ] Manual Deposit is a separate reconciliation line.
- [ ] Manager decision and reason appear in timeline.

## Phase 5 - Platform subscription settlement account module

Implementation:

- [ ] Build list/add/edit for bank, account name/number, status, default and accepted plans.
- [ ] Allow enabled supported banks only.
- [ ] Display mask/derived suffix and ETB currency.
- [ ] Build activate/deactivate/rotate/default actions with confirmation.
- [ ] Display linked payments, match outcomes, export and audit.

Expected:

- [ ] Historical subscription payments retain their original account reference.
- [ ] Full values never appear in client logs or general table views.

## Phase 5 - Plans and subscription purchase module

Implementation:

- [ ] Display exactly Starter 10,000/8,000 ETB, Professional 20,000/13,000 ETB and
  Business 30,000/18,000 ETB.
- [ ] Display one-month expiry, no top-up and one-credit verification rule.
- [ ] Require explicit business and branch.
- [ ] Select payment bank and display matching active Platform account.
- [ ] Build purchase review and payment instruction.

Expected:

- [ ] Purchase cannot silently move to another branch.
- [ ] Plan price/credits come from backend and match the authoritative values.

## Phase 5 - Subscription proof capture module

Implementation:

- [ ] Build JPG/JPEG/PNG/PDF upload, preview, size/type validation and cancellation.
- [ ] Render uploading, reading, QR search/found/no QR/multiple QR/unsupported states.
- [ ] Build camera permission, guide, flash, focus, retake, cancel and upload fallback.
- [ ] Capture automatically when QR is stable.
- [ ] Display extracted fields without manual bank-specific editing.
- [ ] Render submitting, queued/running, pending and terminal results.

Expected:

- [ ] Both capture methods feed the same backend verification workflow.
- [ ] Active document content is not executed in preview.

## Phase 5 - Subscription activation and credits module

Implementation:

- [ ] Display payment verified, adding credits, settling deferred deduction, activated
  and invoice-ready states.
- [ ] Display credit before/granted/deducted/final values.
- [ ] Display exact zero-credit results: 9,999, 19,999 or 29,999.
- [ ] Display 75%, 90% and 100% branch alerts and expiry/history.
- [ ] Display no activation/grant on mismatch, failure or duplicate.

Expected:

- [ ] Owner can understand exactly why one branch credit was consumed/deferred.
- [ ] Ordinary verification remains unavailable when branch balance is zero.

## Phase 6 - Fraud module

Implementation:

- [ ] Render same-day proof reuse as duplicate with no credits.
- [ ] Render later-day reuse as suspected fraud.
- [ ] Build purchase-lock and Super Admin investigation views.
- [ ] Build recovery decision/code status and audit timeline.

Expected:

- [ ] Purchasing locks after the backend's third qualifying attempt.
- [ ] Existing branch verification remains available while valid credits remain.

## Phase 6 - Platform monitoring module

Implementation:

- [ ] Build system, Verify.ET, queue, webhook, job and API-error views.
- [ ] Build provider-credit/bank-availability/retry-queue operations.
- [ ] Display actionable sanitized incident data and correlation IDs.

Expected:

- [ ] Super Admin can identify provider/configuration/queue incidents without viewing secrets.

## Phase 7 - Reports and exports module

Implementation:

- [ ] Build shared filters, summaries, tables and background export status.
- [ ] Cover every verification, financial, credit, subscription, provider and fraud
  report listed in the PDF.
- [ ] Keep Manual Deposits separate.
- [ ] Apply role/business/branch scope to UI and export requests.

Expected:

- [ ] Displayed totals agree with backend report results.
- [ ] No filter or export can widen authorization.

## Phase 7 - Notifications module

Implementation:

- [ ] Build role-specific notification center and preferences.
- [ ] Support credit, pending, bank, reconciliation, financial, subscription, fraud,
  provider and platform incident events according to recipient.

Expected:

- [ ] Each role receives only its PDF-defined events and safe data.

## Phase 7 - Audit and archive module

Implementation:

- [ ] Build role-scoped audit timelines.
- [ ] Build Super Admin archive jobs, batches, status, retrieval and audit views.
- [ ] Keep one-year archived data out of normal operational lists.

Expected:

- [ ] Authorized users can investigate history; only Super Admin manages archive.

## Final web completion

- [ ] Every module's implementation, expected behavior and completion tests pass.
- [ ] Four portal route/permission E2E suites pass.
- [ ] Accessibility and responsive checks pass.
- [ ] Browser source, logs and telemetry contain no protected secrets or full accounts.
- [ ] Production build passes and uses the approved backend endpoints.
