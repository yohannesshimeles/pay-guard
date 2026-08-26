param(
  [string]$ApiImage = 'payguard-api:phase10',
  [string]$WorkerImage = 'payguard-worker:phase10',
  [int]$HostPort = 14010
)

$ErrorActionPreference = 'Stop'
$apiContainer = 'payguard-phase10-api-startup'
$workerContainer = 'payguard-phase10-worker-startup'
$invalidApiContainer = 'payguard-phase10-api-invalid-config'
$invalidWorkerContainer = 'payguard-phase10-worker-invalid-config'
$ownedContainers = @(
  $apiContainer, $workerContainer, $invalidApiContainer, $invalidWorkerContainer
)

if ($HostPort -lt 1024 -or $HostPort -gt 65535) {
  throw 'HostPort must be between 1024 and 65535.'
}
foreach ($required in @(
  'PHASE10_DATABASE_URL', 'PHASE10_REDIS_URL', 'PHASE10_S3_ENDPOINT',
  'PHASE10_S3_ACCESS_KEY_ID', 'PHASE10_S3_SECRET_ACCESS_KEY'
)) {
  if (-not [Environment]::GetEnvironmentVariable($required)) {
    throw "$required is required."
  }
}
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw 'Docker CLI is required.'
}

$secretMarkers = @{
  JWT_ACCESS_SECRET = 'phase10-startup-jwt-marker-at-least-thirty-two-characters'
  ACCOUNT_ENCRYPTION_KEY = 'phase10-startup-account-marker-at-least-thirty-two-characters'
  ARCHIVE_ENCRYPTION_KEY = 'phase10-startup-archive-marker-at-least-thirty-two-characters'
}
$runtimeEnvironment = [ordered]@{
  NODE_ENV = 'production'
  PORT = '4000'
  LOG_LEVEL = 'info'
  TRUST_PROXY_HOPS = '1'
  RATE_LIMIT_ENABLED = 'true'
  DATABASE_SCHEMA_VERSION = 'v2'
  DATABASE_URL = $env:PHASE10_DATABASE_URL
  REDIS_URL = $env:PHASE10_REDIS_URL
  JWT_ACCESS_SECRET = $secretMarkers.JWT_ACCESS_SECRET
  ACCOUNT_ENCRYPTION_KEY = $secretMarkers.ACCOUNT_ENCRYPTION_KEY
  ARCHIVE_ENCRYPTION_KEY = $secretMarkers.ARCHIVE_ENCRYPTION_KEY
  ARCHIVE_ENCRYPTION_KEY_ID = 'phase10-startup'
  S3_ENDPOINT = $env:PHASE10_S3_ENDPOINT
  S3_REGION = 'us-east-1'
  S3_BUCKET = 'payguard'
  S3_ACCESS_KEY_ID = $env:PHASE10_S3_ACCESS_KEY_ID
  S3_SECRET_ACCESS_KEY = $env:PHASE10_S3_SECRET_ACCESS_KEY
  S3_FORCE_PATH_STYLE = 'true'
  VERIFYET_ENABLED = 'false'
  FIREBASE_ENABLED = 'false'
  NOTIFICATION_WORKER_POLL_MS = '1000'
}

function Remove-OwnedContainer([string]$name) {
  $match = (& docker ps -a --filter "name=^/${name}$" --format '{{.Names}}')
  if ($LASTEXITCODE -ne 0) { throw 'Unable to query Docker containers.' }
  $matchedName = if ($null -eq $match) { '' } else { ([string]$match).Trim() }
  if ($matchedName -eq $name) {
    & docker rm -f $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to remove $name." }
  }
}

function Get-EnvironmentArguments([bool]$valid) {
  $arguments = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in $runtimeEnvironment.GetEnumerator()) {
    $value = if (-not $valid -and $entry.Key -eq 'RATE_LIMIT_ENABLED') {
      'false'
    } else {
      [string]$entry.Value
    }
    $arguments.Add('-e')
    $arguments.Add("$($entry.Key)=$value")
  }
  return $arguments.ToArray()
}

function Start-Container(
  [string]$name,
  [string]$image,
  [bool]$valid,
  [string[]]$additionalArguments = @()
) {
  $arguments = @(
    'run', '-d', '--name', $name,
    '--add-host', 'host.docker.internal:host-gateway'
  ) + $additionalArguments + (Get-EnvironmentArguments $valid) + @($image)
  & docker @arguments | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to start $name." }
}

function Assert-LogRedaction([string]$name) {
  $previousErrorAction = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    $logLines = & docker logs $name 2>&1
    $logsExitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  if ($logsExitCode -ne 0) { throw "Unable to read logs for $name." }
  $logs = ($logLines -join "`n")
  $forbidden = @(
    $secretMarkers.JWT_ACCESS_SECRET,
    $secretMarkers.ACCOUNT_ENCRYPTION_KEY,
    $secretMarkers.ARCHIVE_ENCRYPTION_KEY,
    $env:PHASE10_S3_SECRET_ACCESS_KEY
  )
  foreach ($value in $forbidden) {
    if ($value -and $logs.Contains($value)) {
      throw "$name printed a configured secret marker."
    }
  }
  return $logs
}

function Wait-ForApiLiveness([string]$name) {
  $lastHttpError = 'no request attempted'
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 `
        -Uri "http://127.0.0.1:${HostPort}/health/live"
      if ($response.StatusCode -eq 200) {
        $logs = Assert-LogRedaction $name
        if (-not $logs.Contains('application.started')) {
          throw 'API startup event was not logged.'
        }
        return
      }
    } catch {
      $lastHttpError = $_.Exception.Message
      Start-Sleep -Milliseconds 500
    }
  }
  $state = (& docker inspect $name --format '{{.State.Status}}').Trim()
  $logs = Assert-LogRedaction $name
  $startupLogged = $logs.Contains('application.started')
  throw "$name did not become live (state=$state, startupLogged=$startupLogged, http=$lastHttpError)."
}

function Wait-ForWorkerStartup([string]$name) {
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    $state = (& docker inspect $name --format '{{.State.Status}}').Trim()
    if ($LASTEXITCODE -ne 0) { throw "Unable to inspect $name." }
    $logs = Assert-LogRedaction $name
    if ($state -eq 'running' -and $logs.Contains('worker.started')) {
      Start-Sleep -Seconds 2
      $stableState = (& docker inspect $name --format '{{.State.Status}}').Trim()
      if ($stableState -ne 'running') { throw "$name did not remain running." }
      return
    }
    if ($state -eq 'exited') { throw "$name exited during bootstrap." }
    Start-Sleep -Milliseconds 500
  }
  throw "$name did not report worker.started."
}

function Assert-InvalidConfigRejected([string]$name, [string]$image) {
  Start-Container $name $image $false
  for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    $state = (& docker inspect $name --format '{{.State.Status}}').Trim()
    if ($state -eq 'exited') {
      $exitCode = [int]((& docker inspect $name --format '{{.State.ExitCode}}').Trim())
      if ($exitCode -eq 0) { throw "$name accepted invalid production configuration." }
      [void](Assert-LogRedaction $name)
      return $exitCode
    }
    Start-Sleep -Milliseconds 500
  }
  throw "$name did not reject invalid production configuration."
}

try {
  foreach ($name in $ownedContainers) { Remove-OwnedContainer $name }

  Start-Container $apiContainer $ApiImage $true @('-p', "${HostPort}:4000")
  Wait-ForApiLiveness $apiContainer
  Remove-OwnedContainer $apiContainer

  Start-Container $workerContainer $WorkerImage $true
  Wait-ForWorkerStartup $workerContainer
  Remove-OwnedContainer $workerContainer

  $apiInvalidExit = Assert-InvalidConfigRejected $invalidApiContainer $ApiImage
  $workerInvalidExit = Assert-InvalidConfigRejected $invalidWorkerContainer $WorkerImage

  Write-Output (@{
    apiStartedIndependently = $true
    workerStartedIndependently = $true
    apiInvalidConfigurationRejected = $true
    workerInvalidConfigurationRejected = $true
    apiInvalidExitCode = $apiInvalidExit
    workerInvalidExitCode = $workerInvalidExit
    configuredSecretMarkersAbsentFromLogs = $true
  } | ConvertTo-Json)
} finally {
  foreach ($name in $ownedContainers) { Remove-OwnedContainer $name }
}
