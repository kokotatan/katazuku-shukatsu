# meeting-autopilot: DB appointment と meeting_run を正にする会議自動運転。
# 5分毎に起動し、予定IDごとに armed -> opened -> recording -> stopping -> digesting -> done と進める。
$ErrorActionPreference = 'Continue'
# PowerShell 5.1 は既定でネイティブexe(npx/node)の標準出力を端末コードページ(日本語環境はcp932)で
# 復号するため、db-agenda/db-meeting-run が出すUTF-8のJSON内の日本語が壊れ ConvertFrom-Json が失敗する。
# 2026-07-24: calendar-sync 復旧で予定に日本語の社名・氏名が入った途端、毎回「JSONが読めない」で
# autopilot全体が停止し、会議が自動で開かれず録画も起動しなかった。ネイティブ出力をUTF-8で読ませて回避する。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $repo 'logs\meeting-record.log'
$satellite = Test-Path (Join-Path $repo '.katazuku-satellite')
$remoteDbCli = Join-Path $PSScriptRoot 'invoke-minipc-db.ps1'
function Log($m) { ("{0} [autopilot] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }

# 多重起動ガード(2026-08-10): npx呼び出しが遅く1回の実行が数分かかるため、5分毎のタスクが
# 追い越して同一予定のstate読み取りが競合し、同じ会議URLを2回開いた(17:46と17:47の実害)。
# ロックファイルが10分未満なら後発は何もせず終了。10分超の残骸は前回の異常終了とみなして上書き。
$lockFile = Join-Path $repo 'logs\meeting-autopilot.lock'
if (Test-Path $lockFile) {
  $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($lockAge.TotalMinutes -lt 10) { Log '別のautopilotが実行中のためスキップ(多重起動ガード)'; return }
}
Set-Content -Path $lockFile -Value $PID -Encoding ascii
try {

function Get-RunState([int]$appointmentId) {
  $json = ''
  if ($satellite) {
    $json = & $remoteDbCli -Operation meeting-ensure -AppointmentId $appointmentId 2>>$log | Select-Object -Last 1
  } else { try {
    Push-Location (Join-Path $repo 'sync')
    $json = npx tsx scripts/db-meeting-run.ts ensure $appointmentId 2>$null | Select-Object -Last 1
  } finally { Pop-Location } }
  if (-not $json) { return $null }
  try { return ($json | ConvertFrom-Json) } catch { Log "meeting_runのJSONが読めない: $json"; return $null }
}

function Move-Run([int]$appointmentId, [string]$state, [string]$message = '') {
  if ($satellite) {
    & $remoteDbCli -Operation meeting-transition -AppointmentId $appointmentId -State $state -Message $message 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  } else { try {
    Push-Location (Join-Path $repo 'sync')
    npx tsx scripts/db-meeting-run.ts transition $appointmentId $state $message 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  } finally { Pop-Location } }
}

$agendaJson = ''
if ($satellite) {
  $agendaJson = & $remoteDbCli -Operation agenda 2>>$log | Select-Object -Last 1
} else { try {
  Push-Location (Join-Path $repo 'sync')
  $agendaJson = npx tsx scripts/db-agenda.ts 2>$null | Select-Object -Last 1
} finally { Pop-Location } }
if (-not $agendaJson) { return }
$agenda = @()
try { $agenda = $agendaJson | ConvertFrom-Json } catch { Log "agendaのJSONが読めない: $agendaJson"; return }

$now = Get-Date
foreach ($a in $agenda) {
  $start = ([datetime]$a.startIso).ToLocalTime()
  $end = ([datetime]$a.endIso).ToLocalTime()
  $run = Get-RunState ([int]$a.id)
  if (-not $run -or $run.state -eq 'done') { continue }

  if ($run.state -eq 'armed' -and $now -ge $start.AddMinutes(-10) -and $now -lt $end) {
    # 連続面談ガード(2026-08-10 本人指摘「Meetのリンク開きすぎ」): 別の会議がいま進行中なら
    # URLを開かない。面談中に次のMeetが開くとフォーカスを奪い実害があるため。armedのまま次巡回へ。
    # 進行中の会議が終わった時点でまだ次の会議の時間内なら、その巡回で開く。
    $concurrent = $agenda | Where-Object {
      $_.id -ne $a.id -and (([datetime]$_.startIso).ToLocalTime()) -le $now -and $now -lt (([datetime]$_.endIso).ToLocalTime())
    }
    if ($concurrent) {
      Log ("別会議が進行中のためURLを開かず待機: {0} {1}" -f $a.company, $a.title)
      continue
    }
    if ($a.url) {
      # 短縮リンク(weburl.jp等)も含め、URLがあれば必ず開く。ブラウザが302リダイレクトを解決する。
      # openable は会議ホスト許可リスト(sync/src/meeting-url.ts)での判定結果。診断用に記録するだけで開閉は止めない。
      Start-Process $a.url
      $known = if ($a.openable) { '会議ホスト認識' } else { '未知ホスト(短縮リンクの可能性・そのまま開く)' }
      Log ("URLを開いた[{0}]: {1} {2} ({3})" -f $known, $a.company, $a.title, $a.url)
    } else {
      Log ("URLなしの予定を開始待機にした: {0} {1}" -f $a.company, $a.title)
    }
    Move-Run ([int]$a.id) 'opened'
    $activityArgs = @{
      By = 'meeting-autopilot'
      Action = ("会議を開始待機: {0} {1}" -f $a.company, $a.title)
      Why = '10分前に本人が会議へ入れる状態を作るため'
      How = 'DB予定を確認しURLを一度だけ起動'
      Link = $a.url
      Result = '成功'
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') @activityArgs | Out-Null
    $run = Get-RunState ([int]$a.id)
  }

  # 録音は開始5分前から待機する(本人指示 2026-07-29: 冒頭から録る)。タスクは5分毎なので、
  # 開始「5分後」条件だと最悪で冒頭9分が欠けていた。5分前解禁なら、どの巡回タイミングでも
  # 会議開始時刻までに録音が立ち上がる(録音前の無音は文字起こしで[無音]になるだけで害がない)。
  if ($run.state -eq 'opened' -and $now -ge $start.AddMinutes(-5) -and $now -lt $end) {
    $title = ("{0}-{1}" -f $a.company, $a.title)
    # record-vac.ps1 に付け替えた(2026-08-14)。理由は2つ。
    # (1) 旧 record-audio.ps1 は内蔵マイクだけを掴むため相手の声が入らず、さらに0バイトで死ぬ事象が続いた。
    #     record-vac は virtual-audio-capturer(既定の再生デバイスのループバック)と内蔵マイクを混ぜるので、
    #     ヘッドセットでも相手の声が録れる([[interview-recording-setup]])。
    # (2) 旧呼び出しは -StartTime "2026-08-14 17:16:30" のように空白入りの値を
    #     Start-Process -ArgumentList へ渡していた。PowerShell 5.1 はここで空白ごとに引数を割り、
    #     埋め込んだ " も落とすため、record-audio 側は壊れた引数を受け取って起動に失敗していた。
    #     これが「自動録音が動かない」の真因。渡す値は空白なし(ISOのTつなぎ・スラッグ)に統一する。
    # スクショも record-vac が録音と同じスラッグで面倒を見るため、ここでは起動しない
    # (digest が <録音ファイル名>-shots を探す規約に自動で揃う)。
    $slug = (($a.company -replace '[\\/:*?"<>|\s]', '') + '-' + $a.id)
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $PSScriptRoot 'record-vac.ps1')),
      '-AppointmentId', ([int]$a.id),
      '-StartIso', $start.ToString('yyyy-MM-ddTHH:mm:ss'),
      '-EndIso', $end.ToString('yyyy-MM-ddTHH:mm:ss'),
      '-Slug', $slug)
    Move-Run ([int]$a.id) 'recording'
    Log ("録音を開始した(record-vac): {0} / slug={1} (予定ID {2})" -f $title, $slug, $a.id)
    $recordArgs = @{
      By = 'meeting-autopilot'
      Action = ("会議の録音を自動開始: {0}" -f $title)
      Why = '議事録・面接改善・人物記録の元データを漏らさないため'
      How = '開始5分前から録音し、予定IDを付けて厳格JSON反映へ連鎖'
      Link = 'logs/meeting-record.log'
      Result = '録音中'
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') @recordArgs | Out-Null
    $run = Get-RunState ([int]$a.id)
  }

  if ($run.state -eq 'recording' -and $now -ge $end.AddMinutes(4)) {
    Move-Run ([int]$a.id) 'stopping'
    if ($satellite) {
      & $remoteDbCli -Operation meeting-done -AppointmentId ([int]$a.id) 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    } else { try {
      Push-Location (Join-Path $repo 'sync')
      npx tsx scripts/db-meeting-done.ts $a.id 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
      npx tsx scripts/db-snapshot.ts 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    } finally { Pop-Location } }
    Log ("録音終了待ちへ進めた: {0} {1}" -f $a.company, $a.title)
  } elseif ($run.state -eq 'opened' -and $now -ge $end) {
    Move-Run ([int]$a.id) 'failed' '予定終了までに録音を開始できなかった'
    Log ("録音開始を逃した: {0} {1}" -f $a.company, $a.title)
  }
}

} finally {
  Remove-Item $lockFile -ErrorAction SilentlyContinue
}
