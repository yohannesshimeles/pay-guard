# Database Migration Workflow

## Rules

1. Never edit a migration after it has been applied to a shared environment.
2. Generate a new timestamped migration for every schema change.
3. Keep data backfills explicit and idempotent.
4. Prefer expand/migrate/contract deployments for breaking changes.
5. A rollback runs only when an explicit matching `.down.sql` file exists.
6. Back up production and test restoration before destructive changes.

## Commands

```powershell
npm run migration:create -- add_transaction_lookup_index
npm run migration:status:dev
npm run migration:up:dev
npm run migration:down:dev
```

For a new empty Version 2 database only:

```powershell
npm run migration:v2:status:dev
npm run migration:v2:up:dev
```

Do not run the Version 2 baseline against a database containing the legacy `001` and
`002` schema. Point `DATABASE_URL` at a new empty database first.

## Safety provided by the runner

- PostgreSQL advisory lock prevents concurrent migration deploys.
- Every migration and history insert runs in one transaction.
- SHA-256 checksums detect edits to applied migrations.
- Duplicate version numbers and invalid filenames are rejected.
- Status reports pending/applied migrations without changing application tables.
- Rollback is blocked unless a reviewed down script exists.

Migration filenames use `YYYYMMDDHHMMSS_description.sql`. Down files use the same
name ending in `.down.sql` and are never treated as forward migrations. The generator
does not create a placeholder down file, so rollback remains blocked by default.
