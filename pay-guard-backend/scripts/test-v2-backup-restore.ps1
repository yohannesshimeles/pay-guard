param(
  [string]$SourceDatabase = 'payguard_v2',
  [string]$RestoreDatabase = 'payguard_v2_restore_test',
  [string]$DatabaseUser = 'payguard'
)

$ErrorActionPreference = 'Stop'

if ($RestoreDatabase -notmatch '^[a-zA-Z0-9_]+_restore_test$') {
  throw 'RestoreDatabase must end in _restore_test.'
}
if ($SourceDatabase -notmatch '^[a-zA-Z0-9_]+$') {
  throw 'SourceDatabase contains unsupported characters.'
}
if ($SourceDatabase -eq $RestoreDatabase) {
  throw 'SourceDatabase and RestoreDatabase must be different.'
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI was not found. Run this script from a terminal where Docker Desktop is available.'
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$backupDirectory = Join-Path $projectRoot 'backups'
$backupPath = Join-Path $backupDirectory 'payguard-v2-restore-test.dump'
$resolvedProjectRoot = [System.IO.Path]::GetFullPath($projectRoot)
$resolvedBackupPath = [System.IO.Path]::GetFullPath($backupPath)
if (-not $resolvedBackupPath.StartsWith($resolvedProjectRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Backup path escaped the backend project directory.'
}

New-Item -ItemType Directory -Force -Path $backupDirectory | Out-Null
$containerId = (& docker compose ps -q postgres).Trim()
if (-not $containerId) {
  throw 'The Docker Compose postgres service is not running.'
}

$containerBackup = '/tmp/payguard-v2-restore-test.dump'
& docker exec $containerId pg_dump -U $DatabaseUser -d $SourceDatabase -Fc -f $containerBackup
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
& docker cp "${containerId}:${containerBackup}" $resolvedBackupPath
if ($LASTEXITCODE -ne 0) { throw 'docker cp failed.' }

& docker exec $containerId dropdb -U $DatabaseUser --if-exists $RestoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Unable to reset the guarded restore-test database.' }
& docker exec $containerId createdb -U $DatabaseUser $RestoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Unable to create the restore-test database.' }
& docker exec $containerId pg_restore -U $DatabaseUser -d $RestoreDatabase --exit-on-error $containerBackup
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed.' }

$sourceTables = (& docker exec $containerId psql -U $DatabaseUser -d $SourceDatabase -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';").Trim()
$restoredTables = (& docker exec $containerId psql -U $DatabaseUser -d $RestoreDatabase -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';").Trim()
$sourceMigrations = (& docker exec $containerId psql -U $DatabaseUser -d $SourceDatabase -Atc 'SELECT count(*) FROM schema_migrations;').Trim()
$restoredMigrations = (& docker exec $containerId psql -U $DatabaseUser -d $RestoreDatabase -Atc 'SELECT count(*) FROM schema_migrations;').Trim()

if ($sourceTables -ne $restoredTables) {
  throw "Restore validation failed: source has $sourceTables tables and restored database has $restoredTables."
}
if ($sourceMigrations -ne $restoredMigrations) {
  throw "Restore validation failed: migration-history counts differ."
}

Write-Host "Backup/restore validation passed."
Write-Host "Backup: $resolvedBackupPath"
Write-Host "Restore database retained for inspection: $RestoreDatabase"
