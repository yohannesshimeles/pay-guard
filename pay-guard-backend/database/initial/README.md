# PayGuard Database Initial Baseline

`001_payguard_v2_initial.sql` is the standalone PostgreSQL 16+ baseline derived
from *PayGuard Full Database Documentation, Version 2.0 (4 August 2026)*.

It is intentionally outside `migrations/`. The current backend migrations implement
an earlier identity model and must not be applied together with this script. Use this
baseline for a new empty database after application repositories and services have
been updated to the Version 2.0 membership model.

Example for a disposable database:

```powershell
psql -v ON_ERROR_STOP=1 -d payguard_v2 -f database/initial/001_payguard_v2_initial.sql
```

The script is transactional, creates required extensions, tables, constraints,
indexes, immutable-record guards, and reference seeds. Secrets, initial users and
the Platform Super Admin are not seeded; use controlled bootstrap tooling.

Transfers between settlement accounts, branches, or the Main Business and customer
refund recording are explicitly outside the current product scope. The baseline
therefore contains no transfer/refund tables, ledger entry types, reconciliation
totals, foreign keys, indexes, triggers, or seed data.

`archived_*` is a catalogue pattern rather than a concrete table definition in the
source document. Monthly archive jobs should create archive tables from the active
source schema and record them in `archive_jobs`.

The document gives `supported_banks.logo_file_id` as an FK to `files`, but does not
define or catalogue a `files` table. The baseline retains that column as UUID without
a foreign key until a canonical shared-file table is specified.
