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
    'mcp__google-workspace__search_gmail_messages' 'mcp__google-workspace__get_gmail_message_content' `
    'mcp__google-workspace__get_gmail_messages_content_batch' 'mcp__google-workspace__get_gmail_thread_content' `
    'mcp__google-workspace__modify_gmail_message_labels' 'mcp__google-workspace__batch_modify_gmail_message_labels' `
  *> $logFile

# 30日より古いログは消す
Get-ChildItem $logDir -Filter 'sync-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
