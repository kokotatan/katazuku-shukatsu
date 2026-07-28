# katazuku watchdog — 自動運転が「止まったこと」に気づくための番犬(AI非依存の純PowerShell)
# 見るもの:
#   1. logs/activity-log.jsonl の by別最終実行時刻(定常タスクが期待周期内に動いているか)
#   2. logs/agent-runs/provider-health.local.json(Claude/Codex両方が停止していないか)
# 異常時のみ: Windowsトースト + logs/alert-daily-sync.txt へ追記(asaが翌朝メールで報告)。正常時は無音。
# 手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File scripts/watchdog.ps1 -TestToast
param([switch]$TestToast)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $root 'logs'
$activityLog = Join-Path $logDir 'activity-log.jsonl'
$healthFile = Join-Path $logDir 'agent-runs\provider-health.local.json'
$alertFile = Join-Path $logDir 'alert-daily-sync.txt'
$stateFile = Join-Path $logDir 'watchdog-last.local.json'

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
  } catch {}
}

if ($TestToast) {
  Show-Toast 'katazuku 番犬テスト' '通知チャネルは生きています。この表示が出れば watchdog は動作可能です。'
}

$now = Get-Date
$problems = @()
$notes = @()

# ---- 1. 活動ログの新鮮さ ----
# 期待周期(INFRA.mdの定常タスク表に合わせる。変更したらここも直す)
$expected = @(
  @{ by = 'daily-sync';    maxHours = 30; label = '毎朝の選考同期(daily-sync)' },
  @{ by = 'mail-watch';    maxHours = 12; label = 'メール見張り(mail-watch)' },
  @{ by = 'asa';           maxHours = 30; label = '朝のまとめ(asa)' },
  @{ by = 'calendar-sync'; maxHours = 3;  label = 'カレンダー同期(calendar-sync)' }
)

if (-not (Test-Path $activityLog)) {
  $problems += '活動ログ(logs/activity-log.jsonl)が見つからない。全自動処理が動いていない可能性'
} else {
  $lastSeen = @{}
  foreach ($line in (Get-Content $activityLog -Encoding UTF8 -Tail 1200)) {
    if ([string]::IsNullOrWhiteSpace($line)) { continue }
    try { $e = $line | ConvertFrom-Json } catch { continue }
    if ($null -eq $e.by -or $null -eq $e.ts) { continue }
    try { $t = [DateTimeOffset]::Parse($e.ts).LocalDateTime } catch { continue }
    if (-not $lastSeen.ContainsKey($e.by) -or $t -gt $lastSeen[$e.by]) { $lastSeen[$e.by] = $t }
  }
  foreach ($job in $expected) {
    if (-not $lastSeen.ContainsKey($job.by)) {
      $problems += ('{0}: 直近1200行に実行記録なし' -f $job.label)
      continue
    }
    $ageH = [math]::Round(($now - $lastSeen[$job.by]).TotalHours, 1)
    if ($ageH -gt $job.maxHours) {
      $problems += ('{0}: 最終実行が{1}時間前(期待は{2}時間以内)' -f $job.label, $ageH, $job.maxHours)
    }
  }
}

# ---- 2. プロバイダ健康状態(Claude/Codex両方停止だけが異常。片方停止は正常な引継ぎ中) ----
if (Test-Path $healthFile) {
  try {
    $health = Get-Content $healthFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $down = @()
    foreach ($p in @('claude', 'codex')) {
      $entry = $health.providers.$p
      if ($null -ne $entry -and $null -ne $entry.unavailableUntil) {
        try {
          $until = [DateTimeOffset]::Parse($entry.unavailableUntil).LocalDateTime
          if ($until -gt $now) { $down += ('{0}(復活 {1})' -f $p, $until.ToString('MM/dd HH:mm')) }
        } catch {}
      }
    }
    if ($down.Count -ge 2) {
      $problems += ('ClaudeとCodexの両方が利用枠切れ: {0}。自動運転が完全停止中' -f ($down -join ' / '))
    } elseif ($down.Count -eq 1) {
      $notes += ('{0} が制限中(もう片方へ自動引継ぎ中のはず)' -f $down[0])
    }
  } catch {
    $notes += 'provider-health.local.json の解析に失敗'
  }
}

# ---- 3. 結果 ----
$state = [ordered]@{
  checkedAt = $now.ToString('yyyy-MM-ddTHH:mm:sszzz')
  ok        = ($problems.Count -eq 0)
  problems  = $problems
  notes     = $notes
}
$state | ConvertTo-Json -Depth 4 | Out-File $stateFile -Encoding utf8

if ($problems.Count -gt 0) {
  $body = ($problems -join ' / ')
  Show-Toast 'katazuku 自動運転が止まっています' $body
  ('watchdog|{0}|{1}' -f $state.checkedAt, $body) | Out-File $alertFile -Append -Encoding utf8
  Write-Output ('異常 {0}件: {1}' -f $problems.Count, $body)
} else {
  Write-Output ('正常(通知なし)。notes: {0}' -f ($(if ($notes.Count) { $notes -join ' / ' } else { 'なし' })))
}
