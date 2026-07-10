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
# Gmail MCP は自前 google-workspace 系と claude.ai 直結コネクタ(mcp__claude_ai_*)の両対応
claude -p $prompt `
  --allowedTools 'PowerShell' 'Bash' 'Read' 'Write' 'Glob' 'Grep' `
    'mcp__google-workspace__search_gmail_messages' 'mcp__google-workspace__get_gmail_message_content' `
    'mcp__google-workspace__get_gmail_messages_content_batch' 'mcp__google-workspace__get_gmail_thread_content' `
    'mcp__google-workspace__modify_gmail_message_labels' 'mcp__google-workspace__batch_modify_gmail_message_labels' `
    'mcp__claude_ai_Gmail__*' 'mcp__claude_ai_Google_Calendar__*' 'mcp__claude_ai_Google_Drive__*' `
  *> $logFile

# 実行結果を検査し、失敗の疑いがあれば alert ファイルに残す(asa が翌朝【自動化の故障】として報告する)
$alertFile = Join-Path $logDir 'alert-daily-sync.txt'
$failReason = $null
if (-not (Test-Path $logFile) -or (Get-Item $logFile).Length -lt 200) {
  $failReason = 'ログが空か極小(claude実行自体が失敗した可能性)'
} else {
  $logText = Get-Content -Raw $logFile
  if ($logText -match 'スキップ|service-account\.json がありません|サービスアカウント鍵がありません') {
    $failReason = '早期終了の痕跡(スキップ/サービスアカウント鍵なし)'
  } elseif ($logText -match '認証|ログイン|permission') {
    $failReason = '認証・許可エラーの痕跡'
  }
}
if ($failReason) {
  ("{0} daily-sync 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $failReason, (Split-Path $logFile -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
} elseif (Test-Path $alertFile) {
  # 正常に戻ったら故障アラートは消す
  Remove-Item $alertFile -Force
}

# 30日より古いログは消す
Get-ChildItem $logDir -Filter 'sync-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
