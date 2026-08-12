# V2 Production Cutover Runbook

Status on 5 August 2026: **NO-GO for production switch** until the manual gates in
this document are completed. The automated application and database checks pass.

## Safety model

The V2 baseline is not downgraded with destructive `.down.sql` files. The legacy
database remains unchanged during the initial V2 launch. Application rollback means
routing traffic back to the legacy deployment and preserving the V2 database for
investigation. Backup restoration is disaster recovery, not the first rollback
action.

Never restore a dump over either the legacy or V2 production database during a
routine rollback.

## Required pre-cutover evidence

- [x] V2 migration checksums 001-003 match on the local `payguard_v2` database.
- [x] V2 constraints, immutable-audit trigger, tenant trigger, account-fingerprint
  triggers, and Waiter-session trigger are enabled locally.
- [x] Unit, integration, build, and lint validation pass.
- [x] Active refresh tokens are represented only by hashes.
- [x] Settlement-account plaintext is absent from the schema and integration data.
- [x] Production dependency advisory audit passes with zero vulnerabilities.
- [x] Successfully restore the local V2 Docker backup into the isolated
  `payguard_v2_restore_test` database and verify table/migration counts.
- [ ] Produce and rehearse an encrypted production/staging backup under the
  approved retention and access-control policy before the production switch.
- [ ] Verify production PostgreSQL TLS, HTTPS object storage, secret-manager values,
  ingress/WAF rate limiting, and log redaction.
- [ ] Record the release identifier, operator, approver, maintenance window, and
  rollback decision owner.

## Automated preflight

Use the target environment's real secret-manager injection. Do not paste secrets
into shell history. The command does not print credentials or secret values.

```cmd
set "DATABASE_SCHEMA_VERSION=v2"
npm run cutover:v2:preflight
```

Production preflight fails unless the database URL requires TLS and the S3 endpoint
uses HTTPS. Every item must be `PASS`; a non-production transport warning is
expected only for local validation.

Run the dependency audit from a network-enabled terminal:

```cmd
npm run security:audit:production
```

High or critical production dependency findings are a cutover blocker. Never run
`npm audit fix --force` without reviewing and testing the resulting upgrades.

On 5 August 2026, this command completed successfully with `found 0
vulnerabilities` after the reviewed Fastify, Swagger, UUID, and OpenTelemetry
transitive dependency remediations. The post-upgrade lint, build, 69 unit tests,
and 7 V2 integration tests also passed.

## Backup/restore rehearsal

The script refuses to restore into a database unless its name ends in
`_restore_test`. It never overwrites the source database.

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\test-v2-backup-restore.ps1 `
  -SourceDatabase payguard_v2 `
  -RestoreDatabase payguard_v2_restore_test
```

Retain the restored database for inspection. After approval, remove only the
explicit restore-test database:

```cmd
docker compose exec postgres dropdb -U payguard --if-exists payguard_v2_restore_test
```

Production backup files must be encrypted at rest, access-controlled, checksummed,
and retained according to the approved retention policy.

## Cutover sequence

1. Freeze schema and application writes for the agreed maintenance window.
2. Record legacy and V2 backup identifiers and verify backup checksums.
3. Run `migration:v2:status:dev` against the target; require migrations 001-003
   applied with no pending files.
4. Run `cutover:v2:preflight`; require zero failures.
5. Run the V2 integration suite against a disposable copy of the target schema.
6. Bootstrap or rotate the Platform Super Admin through the controlled scripts.
7. Deploy the candidate with `DATABASE_SCHEMA_VERSION=v2` and the V2 database URL.
8. Verify `/health/live`, `/health/ready`, admin login, Owner login, tenant isolation,
   branch scope, and encrypted settlement-account creation.
9. Re-enable traffic gradually and monitor HTTP 5xx, authentication failures,
   PostgreSQL errors, queue lag, and audit ingestion.
10. Keep the legacy deployment and database available for the rollback window.

## Rollback decision

Rollback immediately for failed readiness, migration checksum mismatch, cross-tenant
access, plaintext credential exposure, audit-write failure, sustained authentication
failure, or unexplained financial/account corruption.

Rollback procedure:

1. Stop new traffic to the V2 deployment.
2. Route traffic back to the unchanged legacy deployment and legacy database.
3. Do not run V2 down migrations.
4. Preserve V2 application/database logs and revoke affected V2 sessions if needed.
5. Keep the V2 database immutable for investigation.
6. Restore a backup only into a new recovery database, validate it, and obtain
   explicit approval before any production replacement.
