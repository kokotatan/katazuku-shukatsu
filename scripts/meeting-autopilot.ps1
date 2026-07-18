# meeting-autopilot: DB appointment と meeting_run を正にする会議自動運転。
# 5分毎に起動し、予定IDごとに armed -> opened -> recording -> stopping -> digesting -> done と進める。
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $repo 'logs\meeting-record.log'
function Log($m) { ("{0} [autopilot] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }

function Get-RunState([int]$appointmentId) {
  $json = ''
  try {
    Push-Location (Join-Path $repo 'sync')
    $json = npx tsx scripts/db-meeting-run.ts ensure $appointmentId 2>$null | Select-Object -Last 1
  } finally { Pop-Location }
  if (-not $json) { return $null }
  try { return ($json | ConvertFrom-Json) } catch { Log "meeting_runのJSONが読めない: $json"; return $null }
}

function Move-Run([int]$appointmentId, [string]$state, [string]$message = '') {
  try {
    Push-Location (Join-Path $repo 'sync')
    npx tsx scripts/db-meeting-run.ts transition $appointmentId $state $message 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  } finally { Pop-Location }
}

$agendaJson = ''
try {
  Push-Location (Join-Path $repo 'sync')
  $agendaJson = npx tsx scripts/db-agenda.ts 2>$null | Select-Object -Last 1
} finally { Pop-Location }
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
    if ($a.url) {
      Start-Process $a.url
      Log ("URLを開いた: {0} {1} ({2})" -f $a.company, $a.title, $a.url)
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

  if ($run.state -eq 'opened' -and $now -ge $start.AddMinutes(5) -and $now -lt $end) {
    $title = ("{0}-{1}" -f $a.company, $a.title)
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $PSScriptRoot 'record-audio.ps1')),
      '-StartTime', ('"{0}"' -f $now.ToString('yyyy-MM-dd HH:mm:ss')),
      '-EndTime', ('"{0}"' -f $end.ToString('yyyy-MM-dd HH:mm:ss')),
      '-Title', ('"{0}"' -f $title),
      '-AppointmentId', ([int]$a.id))
    Move-Run ([int]$a.id) 'recording'
    Log ("録音を開始した: {0} (予定ID {1})" -f $title, $a.id)
    $recordArgs = @{
      By = 'meeting-autopilot'
      Action = ("会議の録音を自動開始: {0}" -f $title)
      Why = '議事録・面接改善・人物記録の元データを漏らさないため'
      How = '開始5分後に録音し、予定IDを付けて厳格JSON反映へ連鎖'
      Link = 'logs/meeting-record.log'
      Result = '録音中'
    }
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') @recordArgs | Out-Null
    $run = Get-RunState ([int]$a.id)
  }

  if ($run.state -eq 'recording' -and $now -ge $end.AddMinutes(4)) {
    Move-Run ([int]$a.id) 'stopping'
    try {
      Push-Location (Join-Path $repo 'sync')
      npx tsx scripts/db-meeting-done.ts $a.id 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
      npx tsx scripts/db-snapshot.ts 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    } finally { Pop-Location }
    Log ("録音終了待ちへ進めた: {0} {1}" -f $a.company, $a.title)
  } elseif ($run.state -eq 'opened' -and $now -ge $end) {
    Move-Run ([int]$a.id) 'failed' '予定終了までに録音を開始できなかった'
    Log ("録音開始を逃した: {0} {1}" -f $a.company, $a.title)
  }
}
