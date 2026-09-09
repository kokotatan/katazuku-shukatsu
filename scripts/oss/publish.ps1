# OSS publish pipeline (the private-side "gate" for pushing core to OSS).
#
# Reflects the private core to the OSS repo (kokotatan/katazuku-shukatsu) safely.
# Gates on scan-secrets (with the private blocklist) AND the full test suite;
# pushes only when both pass.
#
# Usage:
#   powershell -File scripts/oss/publish.ps1            # gate only (scan + test), no push
#   powershell -File scripts/oss/publish.ps1 -Push      # push to OSS if the gate passes
#
# Edit the public core in the sibling OSS repository. See docs/oss-publish.md.

param(
  [switch]$Push,
  [string]$PushBranch = 'main',
  [string]$OssDir = '',
  [string]$OssRepo = "https://github.com/kokotatan/katazuku-shukatsu.git",
  [string]$Blocklist = "$PSScriptRoot/blocklist.txt"
)
# Note: do NOT use ErrorActionPreference='Stop' here. In Windows PowerShell 5.1,
# native commands (git/npm) writing to stderr are wrapped as terminating errors.
# We check $LASTEXITCODE explicitly instead.
$ErrorActionPreference = 'Continue'

if (-not $OssDir) {
  $privateRoot = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
  $OssDir = Join-Path (Split-Path $privateRoot -Parent) 'katazuku-shukatsu-oss'
}

function Assert-LastExit([string]$what) {
  if ($LASTEXITCODE -ne 0) { Write-Error "$what failed (exit $LASTEXITCODE). Aborting."; exit 1 }
}

if (-not (Test-Path $OssDir)) {
  Write-Host "Cloning OSS repo: $OssRepo -> $OssDir"
  git clone $OssRepo $OssDir
  Assert-LastExit "git clone"
} else {
  git -C $OssDir pull --ff-only
  Assert-LastExit "git pull"
}

Write-Host "`n[1/2] scan-secrets (with private blocklist)"
if (-not (Test-Path -LiteralPath $Blocklist -PathType Leaf)) {
  Write-Error "private blocklist is missing: $Blocklist. Refusing to run a shape-only publish gate."
  exit 1
}
$env:SCAN_BLOCKLIST = (Resolve-Path -LiteralPath $Blocklist).Path
node "$OssDir/tools/scan-secrets.mjs" $OssDir
Assert-LastExit "scan-secrets"

Write-Host "`n[2/2] tests"
Push-Location $OssDir
try {
  npm ci --no-audit --no-fund
  Assert-LastExit "npm ci"
  npm test
  Assert-LastExit "npm test"
} finally { Pop-Location }

if ($Push) {
  Write-Host "`nGate passed. Pushing to OSS."
  git -C $OssDir push origin $PushBranch
  Assert-LastExit "git push"
} else {
  Write-Host "`nGate passed (scan + test). Re-run with -Push to publish."
}
