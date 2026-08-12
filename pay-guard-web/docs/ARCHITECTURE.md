# PayGuard Web Architecture

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

## 1. Technology and deployment

- React and TypeScript, delivered by the existing Next.js application.
- Tailwind CSS and shared design-system components.
- TanStack Query for reliable backend server state.
- React Hook Form and Zod for form state and client validation.
- CDN and web application firewall in front of the deployed frontend.
- All authoritative access, credit, ledger, matching and fraud decisions remain in
  the backend.

## 2. Frontend structure

```text
src/
  app/
    (auth)/
    (platform)/
    (owner)/
    (manager)/
    (cashier)/
  features/
    businesses/ branches/ users/
    settlement-accounts/
    verifications/ manual-deposits/
    ledger/ reconciliation/
    credits/ subscriptions/
    fraud/ reports/ monitoring/
  components/
  design-system/
  lib/api/
  lib/auth/
```

Portal layouts share primitives but own separate navigation. Backend session data
supplies role, business and branch scope. Route guards improve navigation but do not
replace server authorization. Query keys always include explicit business/branch
context where applicable; a scope switch invalidates incompatible cached queries.

## 3. Platform Super Admin portal

Navigation:

- Platform Management: Dashboard, Businesses, Business Applications, Branches,
  Platform Users, Roles and Permissions
- Subscriptions: Plans, Active Subscriptions, Verification Credits, Provider Credits,
  Subscription Payments, Credit Transactions, Expiring Credits
- Verification: All, Pending, Failed, Duplicates, Settlement Matches, Provider
  Requests, History
- Banks and API: Supported Banks, Bank Configuration, Verify.ET API, API Keys,
  Webhooks, Usage, Errors, Availability, Retry Queue
- Fraud and Risk: Fraud Center, Red-Flagged Businesses, Duplicate Payments,
  Suspicious Receipts, Recovery Codes, Trust Scores, Investigations
- Finance: Platform Revenue, Subscription Revenue, Payment History, Invoices,
  Subscription Settlement Accounts
- Monitoring: System Health, Verify.ET Uptime, Queue Health, Webhook Deliveries,
  Background Jobs, Audit Logs, Archive Management
- Settings: Global, Security, API, Notification, Retention, Branding, Profile

### Subscription settlement account workspace

List/add/edit views include bank, account name, full number/wallet, derived masked
display, derived suffix, ETB currency, active/inactive/retired status, optional
bank-specific default and accepted plan IDs. Enabled banks only are selectable.
High-risk account fields use protected inputs and masked detail views.

Actions: add, activate, deactivate, rotate, set default, view linked subscription
payments/Verify.ET outcomes, export activity and view audit. Historical payment rows
retain the original account reference after rotation/retirement.

## 4. Business Owner portal

Navigation:

- Business: Dashboard, My Businesses, Profile, Branches
- Users: Managers, Cashiers, Waiters, Invitations, Activity
- Settlement: All Accounts, Add Account, Ledger, Opening Balances, Activity
- Transactions: All, Verified, Pending, Failed, Duplicate, Reversed, Refunded,
  Corrections, Manual Deposits
- Credits: Branch Overview, Usage, Expiring Credits, History
- Subscription: Current Plan, Available Plans, Purchase, Payment Verification,
  History, Invoices
- Reports: Business, Branch, Bank, Transactions, Staff, Credits, Subscription,
  Reconciliation, Export Centre
- Settings: Business, Branch, Security, Notifications, Profile

Every data route resolves an explicit business; branch-scoped routes also resolve an
explicit branch. Users, accounts, credits and subscription purchases never silently
switch branch context.

### Staff removal

The Owner selects a Manager/Cashier/Waiter and sees role, branch, active device, last
login and dependencies. The form requires a reason. It blocks removal of a final
required Manager until a replacement is assigned. Confirmation explicitly states
that sessions/devices will be revoked but financial and audit history remains.
Successful removal changes state to Removed and removes the person from normal lists;
authorized historical/audit views remain searchable.

### Subscription purchase and proof

1. Select business and branch.
2. Select Starter (10,000/8,000 ETB), Professional (20,000/13,000 ETB) or Business
   (30,000/18,000 ETB).
3. Review one-month expiry, no-top-up policy and one-credit verification rule.
4. Choose payment bank and display the active matching Platform settlement account.
5. Complete payment and choose Upload Document or Scan Document.
6. Show extraction, Verify.ET progress, matching, pending/result and activation.
7. On success show granted/deducted/final branch credits and invoice.

Upload accepts JPG, JPEG, PNG and PDF within server-configured limits. UI previews
file name, size and document. States cover uploading, reading, searching, found,
no QR, multiple QR and unsupported file. Multiple QR follows server policy: request
selection or reject.

Camera scan requests permission in context and provides guide frame, flash, focus,
retake, cancel and switch-to-upload. Capture occurs after a valid stable QR. Owner
never manually enters bank-specific decoded values.

Verification states: submitting, API queued/running, payment pending and complete.
Results: verified, amount mismatch, wrong receiver, duplicate, suspected fraud, bank
unavailable and provider unavailable. Activation states: adding credits, settling
deferred deduction, activated and invoice ready.

## 5. Manager portal

Manager scope is permanently one branch and excludes Owner-level revenue and
unrestricted confidential financial data.

- Verification: Live, Pending Rechecks, Failed, Duplicates, History, Manual Review
- Financial: Manual Deposits Review, Withdrawals, Corrections, Reversals,
  Reconciliation
- Staff: Cashiers, Waiters, Activity, Performance
- Reports: Daily, Transaction, Bank, Staff, Reconciliation, Export
- Notifications: Credit, Pending, Bank Availability, Announcements
- Settings: Branch Preferences, Notifications, Security, Profile

Manual Deposit review shows amount, description, effective date/time, masked
settlement account and creator. Manager can flag an entry or create a linked
correction; original entry has no edit/delete action. Pending bank payment remains
yellow and offers no approval while Verify.ET reports pending.

## 6. Cashier portal

- Dashboard: today, live feed, credit alerts, reconciliation status, quick actions
- Verifications: Live, History, Pending Rechecks, Failed, Duplicates
- Cash Operations: Manual Deposit, history, withdrawal, withdrawal history, Daily
  Reconciliation, Balance Review
- Reports: Daily, Transaction, Bank, Waiter, Credit Usage
- Notifications: Credit, Pending, Bank Availability, Announcements
- Settings: Notification Preferences, Security, Profile, Logout

### Manual Deposit

Form fields:

- Required active branch settlement account
- Required positive ETB amount with approved precision
- Required meaningful description
- Required date (future blocked unless configured) and time
- Optional note and validated attachment

Before confirmation, display current calculated balance and backend-returned projected
balance. On success show the immutable posted entry and audit reference. History
shows ID, bank/masked account, amount, description, effective time, created time,
Cashier, posted/corrected status, related correction and timeline. It never presents
edit or delete.

### Daily reconciliation

Show opening balance, verified deposits, Manual Deposits as a separate category,
withdrawals, corrections, expected close, Cashier-confirmed
balance and difference. Cashier submits `DRAFT`; backend returns `MATCHED` or
`DISCREPANCY`, then Manager approves or returns.

## 7. Shared state and API patterns

- TanStack Query owns backend state; URL parameters own shareable filters/ranges.
- Generated/typed client uses the backend's success/message/data/error envelope and
  displays correlation IDs on support-safe failures.
- Verification and financial mutations create and retain idempotency keys until the
  final backend result is known.
- Do not optimistically mark verification, credits, subscription activation, ledger
  posting or reconciliation approval as successful.
- Pending data refresh uses controlled polling or backend event stream.
- Tables are server-filtered/paginated and exports are background jobs.
- Account numbers are masked by default; no provider secret/raw debug object enters
  client state, logs or browser storage.

## 8. Reports, notifications and archive

Reports include daily/weekly/monthly/annual verification; branch/bank/account/staff;
verification statuses; Manual Deposit/withdrawal/correction/reversal;
balance/reconciliation; credit/expiry/subscription; Verify.ET usage/latency/error/
availability/provider credits; and fraud/recovery.

Role-specific notifications follow the PDF recipient matrix. The archive UI is
Super Admin only and shows one-year jobs, batches, retrieval and audit metadata.

## 9. Security and privacy

- Session tokens follow backend short-lived/rotated/revoked behavior; do not store
  sensitive tokens in browser-readable persistent storage.
- Every route/action honors server role and explicit tenant/branch context.
- Validate forms with Zod for usability; backend remains authoritative.
- Uploads follow configured types/size and protected signed access; previews never
  execute document content.
- Never log full accounts, passwords, API keys, raw payment payloads or proof files.
- Apply HTTPS, CSP/security headers, WAF, rate-limit responses and safe error rendering.
- Removed staff sessions expire immediately in the UI.

## 10. Accessibility and responsive behavior

All routes support keyboard navigation, visible focus, associated form labels,
announced validation, non-color status labels and accessible dialogs/tables. Pending
yellow and other statuses always include text/icon. Camera/upload controls have clear
permission, loading, empty, unsupported and recovery states.
