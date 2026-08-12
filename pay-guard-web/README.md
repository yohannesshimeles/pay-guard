# PayGuard Web

React/TypeScript user interface for four PayGuard roles:

- Platform Super Admin
- Business Owner
- Manager
- Cashier

The web application provides administration, branch operations, financial records,
subscriptions, reports and monitoring. It calls only the PayGuard backend and never
connects directly to PostgreSQL or Verify.ET.

## Confirmed revised features

- Platform subscription settlement account management
- Owner multi-business and explicit branch context
- Owner soft-removal of Managers, Cashiers and Waiters
- Cashier Manual Deposit and immutable history
- Manager Manual Deposit review/correction
- Three fixed monthly branch plans
- Subscription proof by document upload or camera scan
- Branch-specific subscription verification credit deduction
- Zero-credit renewal with one deferred deduction

## Documentation

- `docs/ARCHITECTURE.md` - portals, routes, frontend structure and workflows
- `docs/PROJECT-PLAN.md` - feature delivery phases and exit conditions
- `docs/MODULE-IMPLEMENTATION-CHECKLIST.md` - implementation and expected result per feature
- `docs/TEST-IMPLEMENTATION-CHECKLIST.md` - component, route and E2E checks
- `../docs/SOURCE-OF-TRUTH.md` - scope authority and application boundaries

## Current implementation

Phase 1 is implemented: secure backend-for-frontend session routes, role guards,
four portal shells, Owner business/branch scope, fixed staff scope, shared components,
responsive states and automated validation.

```powershell
Copy-Item .env.example .env.local
npm install
npm run dev
```

Open `http://localhost:3000/login`. The backend must be available at the
`PAYGUARD_API_URL` configured in `.env.local`.

Validation commands:

```powershell
npm run lint
npm run typecheck
npm run test:unit
npm run build
npm run test:e2e
```

Use Node.js 20.19 or newer (Node.js 22 LTS is recommended).

See `docs/PHASE-1-VALIDATION.md` for the completed implementation and test checklist.
Phase 2 implementation evidence is in `docs/PHASE-2-VALIDATION.md`.
