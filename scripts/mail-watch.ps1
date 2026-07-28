# katazuku mail-watch — 日中の自律メール対応ループ本体 (タスクスケジューラから毎時起動)
# 役割: 未読メールの見張り→緊急なら返信下書き+カレンダー登録+Windows通知。送信は絶対にしない。
# 登録は register-mail-watch.ps1、解除は Unregister-ScheduledTask -TaskName 'katazuku-mail-watch'
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("mail-watch-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
$notifyFile = Join-Path $logDir 'mail-watch-notify.txt'
$alertFile = Join-Path $logDir 'alert-mail-watch.txt'

# 通知ファイルの実行前の行数を控える(実行後に増えた行だけトーストする)
$notifyBefore = 0
if (Test-Path $notifyFile) { $notifyBefore = @(Get-Content $notifyFile -Encoding UTF8).Count }

$prompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'mail-watch-prompt.md')

("`n===== {0} mail-watch 開始 =====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) | Out-File $logFile -Append -Encoding utf8

# headless実行。ツールは監視・下書き・カレンダー登録に必要な最小限だけ許可する。
# プロンプトは stdin 経由で渡す。本文中のハイフン語や引用符を PowerShell が引数へ
# 分割し、providerが未知オプションとして誤認する事故を避ける(daily-sync と同じ方式)。
$invoke = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$runId = 'mail-watch:' + (Get-Date -Format 'yyyy-MM-dd-HH')
try {
  & $invoke -Workflow 'mail-watch' -RunId $runId `
    -PromptFile (Join-Path $PSScriptRoot 'mail-watch-prompt.md') `
    -Risk 'external-draft' -SideEffectMode 'reconcile' `
    -Capability @('workspace.read', 'workspace.write', 'shell', 'gmail.read', 'gmail.draft', 'gmail.send', 'calendar.read', 'calendar.write') `
    *>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
} catch {
  $_ | Out-File -FilePath $logFile -Append -Encoding utf8
}

# ---- 実行後: 新しく増えた通知行をWindowsトーストで出す ----
function Show-Toast([string]$title, [string]$body) {
  try {
    [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null
    $template = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02)
    $texts = $template.GetElementsByTagName('text')
    $texts.Item(0).AppendChild($template.CreateTextNode($title)) | Out-Null
    $texts.Item(1).AppendChild($template.CreateTextNode($body)) | Out-Null
    $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
    [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show(
      [Windows.UI.Notifications.ToastNotification]::new($template))
  } catch {
    ("トースト表示に失敗: {0}" -f $_.Exception.Message) | Out-File $logFile -Append -Encoding utf8
  }
}

if (Test-Path $notifyFile) {
  $lines = @(Get-Content $notifyFile -Encoding UTF8)
  for ($i = $notifyBefore; $i -lt $lines.Count; $i++) {
    $parts = $lines[$i] -split '\|', 3
    if ($parts.Count -ge 3 -and $parts[0] -eq 'TOAST') { Show-Toast $parts[1] $parts[2] }
  }
}

# ---- 故障検知: ログが極小・認証エラーの痕跡なら alert に残す(asa が翌朝報告する) ----
$failReason = $null
$tail = (Get-Content $logFile -Encoding UTF8 | Select-Object -Last 30) -join "`n"
if ($tail -notmatch '対応|未読') {
  if ($tail -match '認証|ログイン|permission|credential') { $failReason = '認証・許可エラーの痕跡' }
  elseif ($tail.Length -lt 50) { $failReason = '出力が空(agent実行自体が失敗した可能性)' }
}
if ($failReason) {
  ("{0} mail-watch 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $failReason, (Split-Path $logFile -Leaf)) |
    Out-File $alertFile -Append -Encoding utf8
} elseif (Test-Path $alertFile) {
  Remove-Item $alertFile -Force
}

# 14日より古いログは消す
Get-ChildItem $logDir -Filter 'mail-watch-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force
