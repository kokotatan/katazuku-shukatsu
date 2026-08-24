[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('health', 'snapshot', 'check-db', 'activity-report')][string]$Operation
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if ([Environment]::MachineName -ine 'KOKOTATANPC') { throw 'This entry point must run on KOKOTATANPC.' }
if (Test-Path -LiteralPath (Join-Path $repo '.katazuku-satellite')) { throw 'Canonical MiniPC must not have the satellite marker.' }
$db = Join-Path $repo 'data\katazuku.db'
$sync = Join-Path $repo 'sync'

switch ($Operation) {
  'health' {
    [ordered]@{
      hostname = [Environment]::MachineName
      databaseRole = 'canonical'
      databaseExists = Test-Path -LiteralPath $db
      repo = $repo
    } | ConvertTo-Json
  }
  'snapshot' {
    Push-Location $sync
    try { & npx.cmd tsx scripts/db-snapshot.ts; if ($LASTEXITCODE -ne 0) { throw "snapshot exit=$LASTEXITCODE" } }
    finally { Pop-Location }
  }
  'check-db' {
    Push-Location $sync
    try { & npx.cmd tsx scripts/check-db.ts; if ($LASTEXITCODE -ne 0) { throw "check-db exit=$LASTEXITCODE" } }
    finally { Pop-Location }
  }
  'activity-report' {
    & (Join-Path $PSScriptRoot 'activity-report.ps1')
    if ($LASTEXITCODE -ne 0) { throw "activity-report exit=$LASTEXITCODE" }
  }
}
