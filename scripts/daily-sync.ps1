# katazuku 毎日のシート同期 (Windowsタスクスケジューラから起動する)
# 登録方法は docs/MINIPC-SETUP.md を参照
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("sync-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'daily-sync-prompt.md')

# headless実行。ツールは同期に必要な最小限だけ許可する
claude -p $prompt `
  --allowedTools 'PowerShell' 'Bash' 'Read' 'Write' 'Glob' 'Grep' `
    'mcp__claude_ai_Gmail__search_threads' 'mcp__claude_ai_Gmail__get_thread' `
  *> $logFile

# 30日より古いログは消す
Get-ChildItem $logDir -Filter 'sync-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
