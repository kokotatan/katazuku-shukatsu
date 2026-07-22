param(
  [Parameter(Mandatory = $true)][string]$Company,
  [string]$Position = '',
  [ValidateSet('auto', 'codex', 'claude', 'codex-oss')][string]$Agent = 'auto'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$safe = $Company -replace '[\\/:*?"<>|]', '-'
$dbJson = Join-Path $repo ("sync\research-{0}-loop.json" -f $safe)
$logFile = Join-Path $logDir ("research-{0}-{1}.log" -f $safe, (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$promptFile = Join-Path $logDir ("research-{0}-{1}.local.md" -f $safe, (Get-Date -Format 'yyyy-MM-dd_HHmmss'))
$prompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'company-research-prompt.md')
$prompt = $prompt + [Environment]::NewLine + "COMPANY=" + $Company + [Environment]::NewLine + "POSITION=" + $Position + [Environment]::NewLine + "DB_JSON=" + $dbJson
Set-Content -LiteralPath $promptFile -Value $prompt -Encoding UTF8
$runId = ('research:{0}:{1}' -f $safe, (Get-Date).ToString('yyyy-MM-dd'))
$invokeAgent = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$invokeArgs = @{
  Workflow = 'company-research'
  RunId = $runId
  PromptFile = $promptFile
  Risk = 'db-write'
  SideEffectMode = 'direct'
  Agent = $Agent
  Capability = @('workspace.read', 'workspace.write', 'shell', 'web.search')
  OutputFile = $logFile
}
try {
  & $invokeAgent @invokeArgs
} catch {
  Write-Error "企業研究に失敗しました。詳細: $logFile / $($_.Exception.Message)"
  exit 1
}
$ok = (Test-Path $logFile) -and ((Get-Content -Raw -Encoding UTF8 $logFile) -match '===\s*company-research\s*DONE\s*===')
if (-not $ok) { Write-Error "企業研究に失敗しました。詳細: $logFile"; exit 1 }
Write-Output "企業研究完了: $Company"
