[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet('health', 'snapshot', 'check-db', 'activity-report')][string]$Operation
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path -LiteralPath (Join-Path $repo '.katazuku-satellite'))) {
  throw 'This command is only for the notebook satellite.'
}
$configPath = Join-Path $repo 'logs\notebook-minipc.local.json'
if (-not (Test-Path -LiteralPath $configPath)) {
  throw 'Notebook config is missing. Run scripts/setup-notebook-satellite.ps1 first.'
}
$config = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($config.host -notmatch '^[A-Za-z0-9._-]+$') { throw 'Invalid MiniPC host.' }
if ($config.repo -match '["\r\n]') { throw 'Invalid MiniPC repo path.' }

$entry = Join-Path ([string]$config.repo) 'scripts\minipc-remote-entry.ps1'
# SSH先がGit BashでもWindowsパスのバックスラッシュや引用符を解釈させない。
# 実行できる操作は引き続きValidateSetとMiniPC側の入口で限定する。
$quotedEntry = $entry.Replace("'", "''")
$remoteScript = @"
`$ErrorActionPreference = 'Stop'
`$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
& '$quotedEntry' -Operation '$Operation'
if (-not `$?) { exit 1 }
"@
$encodedScript = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
$remoteCommand = 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + $encodedScript
& ssh.exe -o BatchMode=yes -o ConnectTimeout=15 ([string]$config.host) $remoteCommand
if ($LASTEXITCODE -ne 0) { throw "MiniPC operation failed: $Operation exit=$LASTEXITCODE" }
