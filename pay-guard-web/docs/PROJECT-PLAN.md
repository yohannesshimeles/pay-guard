# PayGuard Web Project Plan

Source authority: Revised Compiled Project Plan, Version 2.0, July 2026.

Execution details and module-level completion checks are in
`MODULE-IMPLEMENTATION-CHECKLIST.md`.

## Phase 1 - Foundation

Status: implemented and validated on July 28, 2026. See
`PHASE-1-VALIDATION.md` for the evidence and remaining Phase 2 boundary.

Deliver Tailwind, TanStack Query, React Hook Form, Zod, typed API boundary, auth shell,
role layouts, business/branch context, shared design system, error/loading states,
logging/CI and four role navigation systems.

Exit: every role lands in the correct portal and inaccessible business/branch routes
cannot be opened through normal or direct navigation.

## Phase 2 - Core business setup

Status: first API-connected implementation completed on July 29, 2026. Business
registration/review, branch management, staff access/removal and settlement-account
management are operational. See `PHASE-2-VALIDATION.md`.

Deliver Owner registration/business/branch screens, settlement account forms,
Manager/Cashier/Waiter lists, invitations and the complete soft-removal workflow.

Exit: Owner can configure a branch, assign staff and remove staff with preserved
history messaging and immediate session revocation reflected.

## Phase 3 - Verification operations

Deliver transaction/live/pending/failed/duplicate/history screens, provider/bank
states, settlement match views and Super Admin Verify.ET operations pages.

Exit: all web roles see only their scoped verification operations and pending has no
manual approval action.

## Phase 4 - Ledger and Cashier/Manager operations

Deliver Cashier Manual Deposit/history, withdrawals, balances and daily
reconciliation; Manager review/flag/correction, reversals and reconciliation
decision; Owner ledger/reports.

Exit: daily branch financial operations, including Manual Deposit, complete end to end.

## Phase 5 - Subscriptions and credits

Deliver Platform subscription settlement account UI; Owner plans, explicit branch
selection, upload/camera capture, QR/progress/result states, activation, credits,
expiry, invoices, duplicate/fraud lock and recovery status.

Exit: available-credit and zero-credit purchases clearly display exact final balances.

## Phase 6 - Super Admin, fraud and monitoring

Deliver remaining Platform navigation, system/provider/queue/webhook health, fraud
workspace, recovery codes, finance/global settings and audit views.

Exit: Platform operators can monitor, investigate and control PDF-defined functions.

## Phase 7 - Reports, archive and production hardening

Deliver shared report/filter/export experience, one-year archive UI, accessibility
review, responsive states, performance/security testing and production build.

Exit: the standalone web testing checklist and launch checks all pass.

## Dependencies and sequencing

- Use backend mock contracts until each API slice is ready.
- Official API/provider/account secrets never enter the frontend.
- Camera subscription proof requires HTTPS and supported browser capability; upload
  remains the defined alternative.
- Plan prices/credits come from backend plan data and are tested against the fixed
  PDF values.
