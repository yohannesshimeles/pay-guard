param(
  [string]$SourceDatabase = 'payguard_v2',
  [string]$RestoreDatabase = 'payguard_v2_restore_test',
  [string]$DatabaseUser = 'payguard'
)

$ErrorActionPreference = 'Stop'

if (-not $env:PHASE9_BACKUP_ENCRYPTION_KEY -or $env:PHASE9_BACKUP_ENCRYPTION_KEY.Length -lt 32) {
  throw 'PHASE9_BACKUP_ENCRYPTION_KEY must contain at least 32 characters.'
}

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
$backupPath = Join-Path $backupDirectory 'payguard-v2-restore-test.dump.enc'
$plainBackupPath = Join-Path $backupDirectory 'payguard-v2-restore-test.dump.tmp'
$restoreDumpPath = Join-Path $backupDirectory 'payguard-v2-restore-test.restore.tmp'
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
$containerRestore = '/tmp/payguard-v2-restore-test.decrypted.dump'
& docker exec $containerId pg_dump -U $DatabaseUser -d $SourceDatabase -Fc -f $containerBackup
if ($LASTEXITCODE -ne 0) { throw 'pg_dump failed.' }
& docker cp "${containerId}:${containerBackup}" $plainBackupPath
if ($LASTEXITCODE -ne 0) { throw 'docker cp failed.' }
& node (Join-Path $PSScriptRoot 'phase9-backup-crypto.cjs') encrypt $plainBackupPath $resolvedBackupPath
if ($LASTEXITCODE -ne 0) { throw 'Backup encryption failed.' }
[System.IO.File]::Delete($plainBackupPath)
& docker exec $containerId rm -f $containerBackup
if ($LASTEXITCODE -ne 0) { throw 'Unable to remove the container plaintext backup.' }
& node (Join-Path $PSScriptRoot 'phase9-backup-crypto.cjs') decrypt $resolvedBackupPath $restoreDumpPath
if ($LASTEXITCODE -ne 0) { throw 'Backup authenticated decryption failed.' }
& docker cp $restoreDumpPath "${containerId}:${containerRestore}"
if ($LASTEXITCODE -ne 0) { throw 'Unable to copy the decrypted restore input.' }
[System.IO.File]::Delete($restoreDumpPath)

& docker exec $containerId dropdb -U $DatabaseUser --if-exists $RestoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Unable to reset the guarded restore-test database.' }
& docker exec $containerId createdb -U $DatabaseUser $RestoreDatabase
if ($LASTEXITCODE -ne 0) { throw 'Unable to create the restore-test database.' }
& docker exec $containerId pg_restore -U $DatabaseUser -d $RestoreDatabase --exit-on-error $containerRestore
if ($LASTEXITCODE -ne 0) { throw 'pg_restore failed.' }
& docker exec $containerId rm -f $containerRestore

$sourceTables = (& docker exec $containerId psql -U $DatabaseUser -d $SourceDatabase -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';").Trim()
$restoredTables = (& docker exec $containerId psql -U $DatabaseUser -d $RestoreDatabase -Atc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';").Trim()
$sourceMigrationTable = (& docker exec $containerId psql -U $DatabaseUser -d $SourceDatabase -Atc "SELECT COALESCE(to_regclass('public.schema_migrations')::text,'');").Trim()

if ($sourceTables -ne $restoredTables) {
  throw "Restore validation failed: source has $sourceTables tables and restored database has $restoredTables."
}
if ($sourceMigrationTable) {
  $sourceMigrations = (& docker exec $containerId psql -U $DatabaseUser -d $SourceDatabase -Atc 'SELECT count(*) FROM schema_migrations;').Trim()
  $restoredMigrations = (& docker exec $containerId psql -U $DatabaseUser -d $RestoreDatabase -Atc 'SELECT count(*) FROM schema_migrations;').Trim()
  if ($sourceMigrations -ne $restoredMigrations) {
    throw "Restore validation failed: migration-history counts differ."
  }
}

Write-Host "Authenticated encrypted backup/restore validation passed."
Write-Host "Encrypted backup: $resolvedBackupPath"
Write-Host "Restore database retained for inspection: $RestoreDatabase"
