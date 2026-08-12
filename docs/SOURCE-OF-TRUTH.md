# PayGuard Source of Truth

The sole product-scope authority for this workspace is:

`PayGuard_Revised_Compiled_Project_Plan.pdf`, Version 2.0, July 2026.

The repository documents translate that PDF into project-specific engineering work.
They must not introduce product behavior that is absent from, or conflicts with, the
PDF. If a detail is not defined by the PDF, it is marked as a decision or
pre-production input instead of being treated as approved scope.

## Application allocation

| Application | Users | Responsibility |
| --- | --- | --- |
| PayGuard Web | Platform Super Admin, Business Owner, Manager, Cashier | Administration, business operations, financial records, subscriptions, reports and monitoring |
| PayGuard Backend | All clients and background workers | Security, tenancy, verification, credits, ledger, queues, reporting, audit and integrations |
| PayGuard Android | Waiter | QR scanning, live verification status, personal history and push notifications |

## Authoritative roles

- Platform Super Admin
- Business Owner
- Manager
- Cashier
- Waiter (Android only)

There is no Auditor role.

## Confirmed revision changes

1. Cashier Manual Deposit with immutable ledger posting.
2. Business Owner soft-removal of Managers, Cashiers and Waiters with history preserved.
3. Monthly branch plans: Starter 10,000 credits/8,000 ETB; Professional 20,000/13,000
   ETB; Business 30,000/18,000 ETB.
4. Subscription proof by JPG/JPEG/PNG/PDF upload or camera scan with automatic QR
   extraction.
5. Platform Super Admin management of PayGuard subscription settlement accounts.
6. Exactly one selected-branch credit per initial subscription verification; a
   zero-credit branch records one deferred deduction that is settled after successful
   activation.

## Cross-project invariants

- Platform -> Business -> Branch -> User hierarchy is server enforced.
- Managers, Cashiers and Waiters belong to exactly one branch.
- Credits, staff, accounts, transactions and reports are branch-specific.
- One active settlement account per bank per branch.
- Web and Android call PayGuard only; Verify.ET is backend-only.
- Financial ledger records are immutable; corrections are linked new entries.
- Ordinary customer verification stops at zero branch credits.
- Automatic technical retry, polling and webhook handling never consume another credit.
- Records remain active for one year, then move to encrypted protected archive storage
  with retrieval and audit metadata.
