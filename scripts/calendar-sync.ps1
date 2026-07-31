# Google Calendar -> appointment の定期同期
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("calendar-sync-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$prompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'calendar-sync-prompt.md')
$invoke = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$runId = 'calendar-sync:' + (Get-Date -Format 'yyyy-MM-dd-HHmm')
try {
  & $invoke -Workflow 'calendar-sync' -RunId $runId `
    -PromptFile (Join-Path $PSScriptRoot 'calendar-sync-prompt.md') `
    -Risk 'db-write' -SideEffectMode 'reconcile' `
    -Capability @('workspace.read', 'workspace.write', 'shell', 'calendar.read') `
    -TimeoutMs 600000 `
    *>&1 | Out-File -FilePath $logFile -Encoding utf8
} catch {
  $_ | Out-File -FilePath $logFile -Append -Encoding utf8
}
$alertFile = Join-Path $logDir 'alert-calendar-sync.txt'
$ok = (Test-Path $logFile) -and ((Get-Content -Raw -Encoding UTF8 $logFile) -match '===\s*calendar-sync\s*DONE\s*===')
if (-not $ok) {
  ("{0} calendar-sync 失敗 (詳細: logs/{1})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (Split-Path $logFile -Leaf)) | Out-File -FilePath $alertFile -Append -Encoding utf8
} elseif (Test-Path $alertFile) {
  Remove-Item $alertFile -Force
}
Get-ChildItem $logDir -Filter 'calendar-sync-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
