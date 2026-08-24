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
# 通知の重複判定に使う「変化しない鍵」。$problems の文面には経過時間などの揮発値が入るため、
# 文面をそのまま指紋にすると30分ごとに別物と見なされ、ミュートが一度も効かない
# (2026-08-07: 「16.2時間前」→「16.7時間前」で毎回鳴っていた)。鍵には数値を含めない。
$problemKeys = @()
$notes = @()

# 電源状態を先に見る。このPCは Modern Standby(S0低電力アイドル)のため、バッテリー駆動や
# 蓋を閉じた状態では定時タスクが抑制され、ジョブが壊れていなくても実行が飛ぶ
# (2026-08-01: 21:33〜05:20の約8時間、全タスクが動かなかった)。
# 「壊れている」と「動ける状態になかった」は対処が違うので、番犬は区別して報告する。
$onBattery = $false
try {
  $bat = Get-CimInstance Win32_Battery -ErrorAction Stop | Select-Object -First 1
  if ($bat -and $bat.BatteryStatus -eq 1) { $onBattery = $true }
} catch {}

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
  $problemKeys += 'activity-log-missing'
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
      $problemKeys += ('norecord:{0}' -f $job.by)
      continue
    }
    $ageH = [math]::Round(($now - $lastSeen[$job.by]).TotalHours, 1)
    if ($ageH -gt $job.maxHours) {
      $reason = if ($onBattery) { '(バッテリー駆動のためタスクが抑制されている。ACに繋ぐか常駐機へ移すのが対処)' } else { '' }
      $problems += ('{0}: 最終実行が{1}時間前(期待は{2}時間以内){3}' -f $job.label, $ageH, $job.maxHours, $reason)
      $problemKeys += ('stale:{0}' -f $job.by)
    }
  }
}

# ---- 1.5 定常タスク自体の健康(2026-07-29: autopilotが72h設定+ハングで22時間無音停止した反省) ----
# LastTaskResult 0x41301(267009)=実行中、0x41303(267011)=未実行 は正常扱い
# ハング時の許容時間(分)。これを超えて Running のままなら、番犬が回収する。
# MultipleInstances=IgnoreNew のため、1つ固まると以降の定期実行が全部飛ぶ。検知だけでは
# 止まったままなので、ここで能動的に殺して次の周期から復帰させる(2026-07-31の実害対応)。
$hangLimitMin = @{
  'katazuku-daily-sync' = 70; 'katazuku-mail-watch' = 25; 'katazuku-asa' = 130
  'katazuku-calendar-sync' = 30; 'katazuku-meeting-autopilot' = 10; 'katazuku-evening-brief' = 35
}
foreach ($tn in @('katazuku-daily-sync', 'katazuku-mail-watch', 'katazuku-asa', 'katazuku-calendar-sync', 'katazuku-meeting-autopilot', 'katazuku-evening-brief')) {
  try {
    $task = Get-ScheduledTask -TaskName $tn -ErrorAction Stop
    $info = Get-ScheduledTaskInfo -TaskName $tn -ErrorAction Stop
    $limit = if ($hangLimitMin.ContainsKey($tn)) { $hangLimitMin[$tn] } else { 120 }
    if ($task.State -eq 'Running' -and $info.LastRunTime -lt $now.AddMinutes(-$limit)) {
      $runMin = [math]::Round(($now - $info.LastRunTime).TotalMinutes)
      # 回収: Stop-ScheduledTask だけでは孫プロセス(node/claude/codex)が孤児として残るため、
      # このタスクが起点のプロセスツリーを taskkill /T /F で確実に落とす。
      $killed = 0
      try {
        foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='wscript.exe' or Name='powershell.exe'" -ErrorAction Stop |
                        Where-Object { $_.CommandLine -match 'katazuku' -and $_.CommandLine -match ($tn -replace '^katazuku-', '') })) {
          $started = $null
          try { $started = (Get-Process -Id $p.ProcessId -ErrorAction Stop).StartTime } catch { continue }
          if ($started -gt $now.AddMinutes(-$limit)) { continue }   # 新しい正常な実行は触らない
          & taskkill.exe /PID $p.ProcessId /T /F 2>&1 | Out-Null
          $killed++
        }
        Stop-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
      } catch {}
      $problems += ('{0}: {1}分間ハング(制限{2}分)→ プロセス{3}件を強制終了し次の周期へ復帰させた' -f $tn, $runMin, $limit, $killed)
      $problemKeys += ('hang:{0}' -f $tn)
    } elseif ($info.LastTaskResult -ne 0 -and $info.LastTaskResult -ne 267009 -and $info.LastTaskResult -ne 267011) {
      # タスクの終了コードは「前回の起動の残骸」でしかない。手動実行や次の周期で仕事が
      # 済んでいれば異常ではないので、活動ログ(=実際に仕事をした証拠)の方を信じる。
      # 2026-07-31: 失敗の残骸が残り、実際は成功しているのに鳴り続けた。
      $job = $tn -replace '^katazuku-', ''
      $doneAfter = $false
      if ($lastSeen -and $lastSeen.ContainsKey($job)) {
        $doneAfter = ($lastSeen[$job] -gt $info.LastRunTime) -or ($lastSeen[$job] -gt $now.AddHours(-3))
      }
      if (-not $doneAfter) {
        $problems += ('{0}: 最終実行がエラー(0x{1:X})' -f $tn, $info.LastTaskResult)
        $problemKeys += ('taskerr:{0}:0x{1:X}' -f $tn, $info.LastTaskResult)
      } else {
        $notes += ('{0}: タスクの終了コードは0x{1:X}だが、その後に実際の実行記録があるため正常扱い' -f $tn, $info.LastTaskResult)
      }
    }
  } catch {
    $notes += ('{0}: タスク未登録または取得失敗' -f $tn)
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
      $problemKeys += 'providers-down'
    } elseif ($down.Count -eq 1) {
      $notes += ('{0} が制限中(もう片方へ自動引継ぎ中のはず)' -f $down[0])
    }
  } catch {
    $notes += 'provider-health.local.json の解析に失敗'
  }
}

# ---- 3. 同じ異常を鳴らし続けない ----
# 2026-07-31: 実行間隔を4時間→30分に上げた結果、1つの居座る異常(daily-syncの失敗など、
# 翌朝の定時実行までどうやっても解消しないもの)が1日48回通知されるようになった。
# 「番犬がすぐ止まったと言ってくる」の正体はこれ。狼少年になると本当の異常を見落とす。
# 同一の問題集合(fingerprint)は6時間に1回だけ鳴らす。内容が変われば即座に鳴らす。
# 2026-08-07: 指紋を $problems(文面)から作っていたため、「最終実行が16.2時間前」の数字が
# 30分ごとに変わり、毎回「別の異常」と判定されてミュートが一度も効いていなかった。
# 指紋は揮発値を含まない $problemKeys から作る。
$fingerprint = ($problemKeys | Sort-Object) -join '||'
$shouldNotify = $problems.Count -gt 0

# 電源都合(バッテリー駆動でタスクが抑制されただけ)は「壊れている」ではなく「動ける状態に
# なかった」。外出中はACに繋ぐ以外に手がなく、6時間おきに鳴らしても本人にできることがない。
# 遅延系だけが問題のときは通知間隔を24時間に伸ばす(異常が別種に変われば即座に鳴る)。
$staleOnly = ($problemKeys.Count -gt 0) -and -not ($problemKeys | Where-Object { $_ -notlike 'stale:*' -and $_ -notlike 'norecord:*' })
$powerRelated = $onBattery -and $staleOnly
$muteHours = if ($powerRelated) { 24 } else { 6 }
if ($shouldNotify -and (Test-Path $stateFile)) {
  try {
    $prev = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prev.fingerprint -eq $fingerprint -and $prev.notifiedAt) {
      $since = ($now - [DateTimeOffset]::Parse($prev.notifiedAt).LocalDateTime).TotalHours
      if ($since -lt $muteHours) { $shouldNotify = $false }
    }
  } catch {}
}

# 直前の通知時刻は、鳴らさなかった場合は引き継ぐ(引き継がないと毎回鳴ってしまう)
$notifiedAt = $now.ToString('yyyy-MM-ddTHH:mm:sszzz')
if (-not $shouldNotify -and (Test-Path $stateFile)) {
  try {
    $prev = Get-Content $stateFile -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($prev.fingerprint -eq $fingerprint -and $prev.notifiedAt) { $notifiedAt = $prev.notifiedAt }
  } catch {}
}

$state = [ordered]@{
  checkedAt    = $now.ToString('yyyy-MM-ddTHH:mm:sszzz')
  ok           = ($problems.Count -eq 0)
  problems     = $problems
  problemKeys  = $problemKeys      # 指紋の材料。文面と違い揮発値を含まない
  notes        = $notes
  onBattery    = $onBattery
  powerRelated = $powerRelated     # 真なら「壊れている」ではなく「動ける状態になかった」
  muteHours    = $muteHours
  fingerprint  = $fingerprint
  notifiedAt   = $(if ($problems.Count -gt 0) { $notifiedAt } else { $null })
}
$state | ConvertTo-Json -Depth 4 | Out-File $stateFile -Encoding utf8

if ($problems.Count -gt 0) {
  $body = ($problems -join ' / ')
  if ($shouldNotify) {
    $title = if ($powerRelated) { 'katazuku 電源都合で自動運転が遅れています' } else { 'katazuku 自動運転が止まっています' }
    Show-Toast $title $body
    ('watchdog|{0}|{1}' -f $state.checkedAt, $body) | Out-File $alertFile -Append -Encoding utf8
    # スマホへもWeb Push(spec16)。ロック画面に出るため件数のみの要約にする。失敗しても続行
    try {
      & node (Join-Path $PSScriptRoot 'push-send.mjs') --title 'katazuku 番犬' `
        --body ('自動運転の異常を{0}件検知しました。PCの通知かログを確認してください' -f $problems.Count) `
        --url '/insight/' 2>$null | Out-Null
    } catch {}
    Write-Output ('異常 {0}件: {1}' -f $problems.Count, $body)
  } else {
    Write-Output ('異常 {0}件(通知済みと同内容のため{1}時間は再通知しない): {2}' -f $problems.Count, $muteHours, $body)
  }
} else {
  Write-Output ('正常(通知なし)。notes: {0}' -f ($(if ($notes.Count) { $notes -join ' / ' } else { 'なし' })))
}
