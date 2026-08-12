# PayGuard

PayGuard is a multi-tenant fintech SaaS platform that verifies bank and mobile-wallet
payment receipts, confirms the correct branch receiver, prevents duplicate
confirmations, manages branch verification credits and calculates operational
balances through an immutable ledger.

## Projects

| Project | Users | Scope |
| --- | --- | --- |
| `pay-guard-backend` | All clients/workers | Security, tenancy, Verify.ET, verification, credits, ledger, queues, reporting, audit and integrations |
| `pay-guard-web` | Super Admin, Owner, Manager, Cashier | Administration, operations, finance, subscriptions, reports and monitoring |
| `pay-guard-app` | Waiter | QR scanning, live results, personal history and notifications |

## Documentation map

Begin with `docs/SOURCE-OF-TRUTH.md`. Each project then contains:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/PROJECT-PLAN.md`
- `docs/MODULE-IMPLEMENTATION-CHECKLIST.md`
- `docs/TEST-IMPLEMENTATION-CHECKLIST.md`

All product behavior in those files is derived from
`PayGuard_Revised_Compiled_Project_Plan.pdf`, Version 2.0, July 2026.

## Repository topology decision

The current workspace preserves the previously requested three independent Git
repositories. The revised PDF's roadmap mentions "Monorepo" during Foundation.
That discrepancy requires an explicit decision before CI/CD and shared-contract
automation are implemented; the documentation does not silently change repository
boundaries.

## Confirmed monthly plans

| Plan | Monthly credits | Price |
| --- | ---: | ---: |
| Starter | 10,000 | 8,000 ETB |
| Professional | 20,000 | 13,000 ETB |
| Business | 30,000 | 18,000 ETB |

Credits belong to the selected branch, expire after one month and have no independent
top-up in the current scope.
