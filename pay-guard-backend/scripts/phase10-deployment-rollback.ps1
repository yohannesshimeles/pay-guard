param(
  [string]$BaselineImage = 'payguard-backend:phase10-baseline',
  [string]$CandidateImage = 'payguard-backend:phase10-candidate',
  [int]$HostPort = 14000
)

$ErrorActionPreference = 'Stop'
$baselineContainer = 'payguard-phase10-baseline-test'
$candidateContainer = 'payguard-phase10-candidate-test'

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

$env:NODE_ENV = 'production'
$env:PORT = '4000'
$env:LOG_LEVEL = 'error'
$env:TRUST_PROXY_HOPS = '1'
$env:RATE_LIMIT_ENABLED = 'true'
$env:DATABASE_SCHEMA_VERSION = 'v2'
$env:DATABASE_URL = $env:PHASE10_DATABASE_URL
$env:REDIS_URL = $env:PHASE10_REDIS_URL
$env:JWT_ACCESS_SECRET = 'phase10-rehearsal-jwt-secret-at-least-thirty-two-characters'
$env:ACCOUNT_ENCRYPTION_KEY = 'phase10-rehearsal-account-key-at-least-thirty-two-characters'
$env:ARCHIVE_ENCRYPTION_KEY = 'phase10-rehearsal-archive-key-at-least-thirty-two-characters'
$env:ARCHIVE_ENCRYPTION_KEY_ID = 'phase10-rehearsal'
$env:S3_ENDPOINT = $env:PHASE10_S3_ENDPOINT
$env:S3_REGION = 'us-east-1'
$env:S3_BUCKET = 'payguard'
$env:S3_ACCESS_KEY_ID = $env:PHASE10_S3_ACCESS_KEY_ID
$env:S3_SECRET_ACCESS_KEY = $env:PHASE10_S3_SECRET_ACCESS_KEY
$env:S3_FORCE_PATH_STYLE = 'true'

function Assert-ImageContract([string]$image, [string]$expectedRevision) {
  $imageInfo = @(& docker image inspect $image | ConvertFrom-Json)[0]
  $user = $imageInfo.Config.User
  $health = $imageInfo.Config.Healthcheck.Test
  $revision = $imageInfo.Config.Labels.'org.opencontainers.image.revision'
  if ($user -ne 'node' -or -not $health -or
      $revision -ne $expectedRevision) {
    throw "Image contract failed for $image."
  }
}

function Start-HealthyContainer([string]$name, [string]$image, [int]$port) {
  & docker run -d --name $name --add-host host.docker.internal:host-gateway `
    -p "${port}:4000" `
    -e NODE_ENV -e PORT -e LOG_LEVEL -e TRUST_PROXY_HOPS `
    -e RATE_LIMIT_ENABLED -e DATABASE_SCHEMA_VERSION -e DATABASE_URL `
    -e REDIS_URL -e JWT_ACCESS_SECRET -e ACCOUNT_ENCRYPTION_KEY `
    -e ARCHIVE_ENCRYPTION_KEY -e ARCHIVE_ENCRYPTION_KEY_ID `
    -e S3_ENDPOINT -e S3_REGION -e S3_BUCKET -e S3_ACCESS_KEY_ID `
    -e S3_SECRET_ACCESS_KEY -e S3_FORCE_PATH_STYLE $image | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Unable to start $name." }
  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 `
        -Uri "http://127.0.0.1:${port}/health/live"
      if ($response.StatusCode -eq 200) { return }
    } catch { Start-Sleep -Milliseconds 500 }
  }
  throw "$name did not become live."
}

function Remove-TestContainer([string]$name) {
  $existsOutput = & docker ps -a --filter "name=^/${name}$" `
    --format '{{.Names}}'
  $exists = if ($null -eq $existsOutput) { '' } else { [string]$existsOutput }
  $exists = $exists.Trim()
  if ($exists -eq $name) {
    & docker rm -f $name | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Unable to remove test container $name." }
  }
}

try {
  Remove-TestContainer $baselineContainer
  Remove-TestContainer $candidateContainer

  Assert-ImageContract $BaselineImage 'baseline'
  Assert-ImageContract $CandidateImage 'candidate'
  $baselineId = (& docker image inspect $BaselineImage --format '{{.Id}}').Trim()
  $candidateId = (& docker image inspect $CandidateImage --format '{{.Id}}').Trim()
  if (-not $baselineId -or -not $candidateId -or $baselineId -eq $candidateId) {
    throw 'Baseline and candidate must have distinct immutable image identities.'
  }

  Start-HealthyContainer $baselineContainer $BaselineImage $HostPort
  Remove-TestContainer $baselineContainer

  & docker run -d --name $candidateContainer $CandidateImage | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Unable to start the failure candidate.' }
  Start-Sleep -Seconds 3
  $candidateStatus = (& docker inspect $candidateContainer --format '{{.State.Status}}').Trim()
  $candidateExit = (& docker inspect $candidateContainer --format '{{.State.ExitCode}}').Trim()
  if ($candidateStatus -ne 'exited' -or $candidateExit -eq '0') {
    throw 'Invalid candidate was not rejected before traffic.'
  }
  Remove-TestContainer $candidateContainer

  Start-HealthyContainer $baselineContainer $BaselineImage $HostPort
  $rollbackId = (& docker inspect $baselineContainer --format '{{.Image}}').Trim()
  if ($rollbackId -ne $baselineId) {
    throw 'Rollback did not restore the exact baseline image identity.'
  }
  Write-Output (@{
    baselineImageId = $baselineId
    candidateImageId = $candidateId
    candidateRejected = $true
    candidateExitCode = [int]$candidateExit
    rollbackImageIdVerified = $true
    livenessVerifiedBeforeAndAfter = $true
  } | ConvertTo-Json)
} finally {
  Remove-TestContainer $candidateContainer
  Remove-TestContainer $baselineContainer
}
