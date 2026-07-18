# meeting-autopilot: 会議の自動運転の司令塔(5分毎にタスクスケジューラから起動)。
#
# 本人方針(2026-07-18): 「会議は10分前に勝手に開く。開始5分後に録画が自動開始。
# 会議終了とともに録画終了。そこから議事録・人への追記・今後の計画へ」。
# 正はDBのappointment(カレンダーはDBへの入力にすぎない)。codexレビュー(同日)の
# 「状態機械+予定ID単位の冪等化」を、状態ファイル logs/meetings/ap-<id>.json で実装する。
#
# 各tickでやること:
#   開始10分前〜  : 会議URLを開く(1回だけ)
#   開始5分後〜   : record-audio.ps1 を起動(終了+3分で自動停止→interview-digestへ自動連鎖)
#   終了4分後     : appointmentを完了化(db-meeting-done)+スナップショット反映
# 登録: scripts/register-meeting-autopilot.ps1
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$stateDir = Join-Path $repo 'logs\meetings'
if (-not (Test-Path $stateDir)) { New-Item -ItemType Directory $stateDir -Force | Out-Null }
$log = Join-Path $repo 'logs\meeting-record.log'
function Log($m) { ("{0} [autopilot] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }

# DBから直近の予定を取る(正はDBのみ)
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
  $stateFile = Join-Path $stateDir ("ap-{0}.json" -f $a.id)
  $st = @{ opened = $false; recording = $false; done = $false }
  if (Test-Path $stateFile) {
    try { $j = Get-Content -Raw $stateFile | ConvertFrom-Json; $st.opened = [bool]$j.opened; $st.recording = [bool]$j.recording; $st.done = [bool]$j.done } catch {}
  }
  $dirty = $false

  # 1) 開始10分前: 会議URLを開く
  if (-not $st.opened -and $a.url -and $now -ge $start.AddMinutes(-10) -and $now -lt $end) {
    Start-Process $a.url
    Log ("URLを開いた: {0} {1} ({2})" -f $a.company, $a.title, $a.url)
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') `
      -By 'meeting-autopilot' -Action ("会議URLを自動で開いた: {0} {1}" -f $a.company, $a.title) `
      -Why '10分前に本人が会議に入れる状態を作るため' -How 'DBのappointmentを5分毎に確認して起動' `
      -Link $a.url -Result '成功' | Out-Null
    $st.opened = $true; $dirty = $true
  }

  # 2) 開始5分後: 録音開始(終了+3分で自動停止→議事録が自動で走る)
  if (-not $st.recording -and $now -ge $start.AddMinutes(5) -and $now -lt $end) {
    $title = ("{0}-{1}" -f $a.company, $a.title)
    Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f (Join-Path $PSScriptRoot 'record-audio.ps1')),
      '-StartTime', ('"{0}"' -f $now.ToString('yyyy-MM-dd HH:mm:ss')),
      '-EndTime', ('"{0}"' -f $end.ToString('yyyy-MM-dd HH:mm:ss')),
      '-Title', ('"{0}"' -f $title))
    Log ("録音を開始した: {0} (終了予定 {1} +3分)" -f $title, $end.ToString('HH:mm'))
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') `
      -By 'meeting-autopilot' -Action ("会議の録音を自動開始: {0}" -f $title) `
      -Why '議事録・面接改善・人脈記録の元データを漏らさないため' `
      -How ("開始5分後に record-audio を起動。{0}+3分に自動停止し議事録へ連鎖" -f $end.ToString('HH:mm')) `
      -Link 'logs/meeting-record.log' -Result '録音中' | Out-Null
    $st.recording = $true; $dirty = $true
  }

  # 3) 終了4分後: 完了化 + スナップショット(アプリへ即反映)
  if (-not $st.done -and $now -ge $end.AddMinutes(4)) {
    try {
      Push-Location (Join-Path $repo 'sync')
      npx tsx scripts/db-meeting-done.ts $a.id 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
      npx tsx scripts/db-snapshot.ts 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
    } finally { Pop-Location }
    Log ("完了化した: {0} {1}" -f $a.company, $a.title)
    $st.done = $true; $dirty = $true
  }

  if ($dirty) { ($st | ConvertTo-Json -Compress) | Out-File -FilePath $stateFile -Encoding ascii }
}
