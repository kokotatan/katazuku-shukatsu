# katazuku reconcile-calendar — 選考マスタ(シート)→カレンダーの整合を取る (タスクスケジューラ想定)
# 役割: 選考管理（新）の合否・参加状況を career カレンダーの色/参加予定に反映。
#   不合格・辞退=グレー / 参加確定=トマト / 抜けは新規登録 / 日程衝突は検出のみ。個人カレンダーは読むだけ。
# 破壊的操作(削除)はしない。冪等(実態と一致していれば無変更)。
# 安全既定: 引数なしだと DryRun(報告のみ)。実際にカレンダーへ書き込むときだけ -Apply を渡す。
# こうすればスイッチのバインドが万一失敗しても、既定が安全側(無変更)に倒れる。
[CmdletBinding()]
param([switch]$Apply)
$DryRun = -not $Apply

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("reconcile-calendar-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd'))
$notifyFile = Join-Path $logDir 'reconcile-notify.txt'
$alertFile = Join-Path $logDir 'alert-reconcile.txt'

# 無効なAPIキーが混入していると認証エラーになるので、このプロセスでは外す
$env:ANTHROPIC_API_KEY = $null

# 通知ファイルの実行前の行数を控える(実行後に増えた行だけトーストする)
$notifyBefore = 0
if (Test-Path $notifyFile) { $notifyBefore = @(Get-Content $notifyFile -Encoding UTF8).Count }

$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'reconcile-calendar-prompt.md')
if ($DryRun) {
  $prompt = "【ドライラン】manage_event は呼ばない(カレンダーは変更しない)。`n" +
            "TOAST 行と要約は応答テキストに出力するだけにする(reconcile-notify.txt には書かない=実変更のみを残す)。`n`n" + $prompt
}

$mode = if ($DryRun) { 'DryRun' } else { 'Apply' }
("`n===== {0} reconcile-calendar 開始 ({1}) =====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $mode) |
  Out-File $logFile -Append -Encoding utf8

# DryRun時はcalendar.write capabilityを渡さず、物理的に変更できないようにする。
$capabilities = @('workspace.read', 'sheets.read', 'calendar.read')
$risk = 'read-only'
$sideEffectMode = 'none'
if (-not $DryRun) {
  $capabilities += @('workspace.write', 'calendar.write')
  $risk = 'external-commit'
  $sideEffectMode = 'reconcile'
}

# agent本体の出力は UTF-8。PS5.1 の *>> は既定 UTF-16LE になり文字化けし、下の故障検知(UTF-8読み)が
# 壊れる。OutputEncoding を UTF-8 にしたうえで Out-File -Encoding utf8 に統一する。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$invoke = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$runId = 'reconcile-calendar:' + $mode + ':' + (Get-Date -Format 'yyyy-MM-dd')
try {
  & $invoke -Workflow 'reconcile-calendar' -RunId $runId -PromptText $prompt `
    -Risk $risk -SideEffectMode $sideEffectMode -Capability $capabilities `
    *>&1 | Out-File $logFile -Append -Encoding utf8
} catch {
  $_ | Out-File $logFile -Append -Encoding utf8
}

# ---- 実行後: 新しく増えた通知行を Windows トーストで出す ----
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

if ((-not $DryRun) -and (Test-Path $notifyFile)) {
  $lines = @(Get-Content $notifyFile -Encoding UTF8)
  for ($i = $notifyBefore; $i -lt $lines.Count; $i++) {
    $parts = $lines[$i] -split '\|', 3
    if ($parts.Count -ge 3 -and $parts[0] -eq 'TOAST') { Show-Toast $parts[1] $parts[2] }
  }
}

# ---- 故障検知: ログに要約が無い・認証エラーの痕跡なら alert に残す(asa が翌朝報告する) ----
$failReason = $null
$tail = (Get-Content $logFile -Encoding UTF8 | Select-Object -Last 30) -join "`n"
if ($tail -notmatch '対象|色変更|衝突') {
  if ($tail -match '認証|ログイン|permission|credential') { $failReason = '認証・許可エラーの痕跡' }
  elseif ($tail.Length -lt 50) { $failReason = '出力が空(agent実行自体が失敗した可能性)' }
}
if ($failReason) {
  ("{0} reconcile-calendar 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $failReason, (Split-Path $logFile -Leaf)) |
    Out-File $alertFile -Append -Encoding utf8
} elseif (Test-Path $alertFile) {
  Remove-Item $alertFile -Force
}

# 14日より古いログは消す
Get-ChildItem $logDir -Filter 'reconcile-calendar-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-14) } |
  Remove-Item -Force
