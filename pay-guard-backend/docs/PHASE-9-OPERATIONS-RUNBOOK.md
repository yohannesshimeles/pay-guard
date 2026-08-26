# Phase 9 Operations Runbook

## Ownership and alert contract

Production deployment must replace the role placeholders below with named primary and
secondary people in the alert manager before the production exercise can close.

| Signal | Alert condition | Primary role | Secondary role |
| --- | --- | --- | --- |
| `payguard_worker_tick_failures_total{worker="verify_et"}` | any increase for 2 minutes | Backend on-call | Payments on-call |
| `payguard_worker_results_total{worker="verify_et",outcome="PAUSED_PROVIDER"}` | any increase | Payments on-call | Security on-call |
| `payguard_worker_results_total{worker="verify_et",outcome="DEFERRED"}` | sustained increase without `PROCESSED` for 10 minutes | Payments on-call | Backend on-call |
| `payguard_worker_tick_failures_total{worker="report_export"}` | any increase for 5 minutes | Backend on-call | Platform on-call |
| `payguard_worker_results_total{worker="report_export",outcome="FAILED"}` | any increase | Backend on-call | Platform on-call |
| `payguard_worker_tick_failures_total{worker="archive"}` | any increase | Platform on-call | Security on-call |
| `payguard_worker_tick_failures_total{worker="notification"}` | any increase for 5 minutes | Backend on-call | Platform on-call |

The metrics contain only fixed worker/outcome labels. Never add transaction, account,
provider request, delivery, user, business or storage identifiers as metric labels.

Deploy `monitoring/payguard.rules.yml` through the production monitoring configuration.
The rule file carries role routes only; the alert manager must map every primary and
secondary role to a named person before launch. Validate any edited rules with:

```powershell
npm run test:phase10:alerts
npm run test:phase10:alerts:promtool
```

The first command enforces the approved alert inventory, telemetry allowlist, distinct
role routes and annotation hygiene. The second runs the rule file through the pinned
Prometheus `promtool` parser. Neither command proves delivery; the production exercise
must record both human acknowledgements.

## Queue/provider incident exercise

1. Confirm the worker process exposes both Phase 9 metric families on `/metrics`.
2. In a production-equivalent environment, block Verify.ET egress. Confirm retryable
   errors become `DEFERRED`, leases remain reclaimable, and no credit is consumed.
3. Return provider HTTP 401 or 403. Confirm the item becomes `PAUSED_PROVIDER`, an
   idempotent critical operational alert is created, and the queue does not hot-loop.
4. Replay one signed webhook concurrently. Confirm one durable delivery and duplicate
   acknowledgements without retaining its raw body. Restore egress and verify drain.
5. Force one report/archive worker tick failure. Confirm the correct alert routes to
   both named owners and that a later tick resumes from durable state.
6. Record timestamps, alert IDs, acknowledgements, recovery time, and owner names in
   the deployment evidence. Raw payloads and credentials must not enter the evidence.

## Encrypted backup and archive recovery

The guarded rehearsal refuses a restore target that does not end in `_restore_test`.
It derives an AES-256-GCM backup key from `PHASE9_BACKUP_ENCRYPTION_KEY`, authenticates
the entire PostgreSQL custom-format dump, deletes plaintext staging copies, restores
from the decrypted authenticated bytes, and compares source/restored table counts.

After preserving an archive exercise object, run the backup rehearsal, then set
`ARCHIVE_RECOVERY_DATABASE_URL` to the isolated restored database and run:

```powershell
node scripts/phase9-archive-recovery.cjs
```

The recovery verifier accepts only an `_restore_test` database, uses the configured
archive keyring, rechecks the encrypted package and record hashes, verifies recovered
bytes, and writes an immutable Platform Super Admin retrieval event.

## Archive key rotation

1. Generate a new managed secret and a non-secret unique key ID.
2. Move the old ID/secret into `ARCHIVE_PREVIOUS_ENCRYPTION_KEYS`, a JSON object.
3. Set the new `ARCHIVE_ENCRYPTION_KEY_ID` and `ARCHIVE_ENCRYPTION_KEY`; deploy and
   retrieve at least one archive created under the previous ID.
4. Create and retrieve a new archive and confirm its envelope contains the new ID.
5. Keep old decryption keys for the full archive retention period. Retirement requires
   a separately approved re-encryption migration and successful recovery rehearsal.

Application tests prove the rotation keyring can read old archives and refuses them
once the old key is removed. A production managed-key drill and named-owner alert
acknowledgement remain deployment actions and must not be inferred from local tests.
