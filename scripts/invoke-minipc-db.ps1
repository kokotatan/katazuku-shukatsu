# ノートPCからMiniPC上の正本DBを操作する唯一の入口。
#
# - 呼べるCLIを許可リストへ限定する
# - JSON入力はASCII名で logs/handoff-in へ転送する
# - 書込み後はMiniPC上で必ずdb-snapshotを実行する
# - ローカルとMiniPCのGit版が違えば警告する
#
# 例:
#   .\scripts\invoke-minipc-db.ps1 -Operation agenda
#   .\scripts\invoke-minipc-db.ps1 -Operation apply-submission -InputPath .\tmp\submission.json
#   .\scripts\invoke-minipc-db.ps1 -Operation meeting-transition -AppointmentId 123 -State opened
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet(
    'agenda', 'appointment-times', 'calendar-conflicts',
    'meeting-ensure', 'meeting-transition', 'meeting-done',
    'career-meeting-ensure', 'career-meeting-transition', 'career-meeting-done',
    'apply-selection', 'apply-submission', 'apply-mail', 'apply-calendar', 'apply-career-calendar',
    'apply-research', 'apply-person',
    'email-prepare', 'email-approve', 'email-reject', 'email-send', 'email-status'
  )]
  [string]$Operation,
  [string]$InputPath = '',
  [string]$RunId = '',
  [int]$AppointmentId = 0,
  [int]$CareerMeetingId = 0,
  [string]$StartIso = '',
  [string]$EndIso = '',
  [int]$ExcludeAppointmentId = 0,
  [ValidateSet('', 'armed', 'opened', 'recording', 'stopping', 'digesting', 'done', 'failed')]
  [string]$State = '',
  [string]$Message = '',
  [string]$SshHost = $(if ($env:KATAZUKU_DB_HOST) { $env:KATAZUKU_DB_HOST } else { 'minipc' }),
  [string]$RemoteRepoName = $(if ($env:KATAZUKU_REMOTE_REPO_NAME) { $env:KATAZUKU_REMOTE_REPO_NAME } else { 'katazuku-shukatsu-private' })
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$marker = Join-Path $repo '.katazuku-satellite'
if (-not (Test-Path -LiteralPath $marker)) {
  throw 'このCLIはノートPC専用です。.katazuku-satellite が無い端末では実行しません。'
}
if ($RemoteRepoName -notmatch '^[a-zA-Z0-9._-]+$') { throw 'RemoteRepoName はホーム直下の単一フォルダ名だけ指定できます' }

function Invoke-Remote([string]$Command) {
  & ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost $Command
  if ($LASTEXITCODE -ne 0) { throw "MiniPC上の処理に失敗しました(exit=$LASTEXITCODE): $Operation" }
}

function Invoke-RemoteCapture([string]$Command) {
  $output = @(& ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost $Command)
  if ($LASTEXITCODE -ne 0) { throw "MiniPC上の処理に失敗しました(exit=$LASTEXITCODE): $Operation" }
  return $output
}

function Warn-VersionDifference {
  $localHead = (& git -C $repo rev-parse HEAD 2>$null | Select-Object -Last 1)
  $remoteHead = (& ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost ("cd ~/" + $RemoteRepoName + " && git rev-parse HEAD") 2>$null | Select-Object -Last 1)
  if ($LASTEXITCODE -ne 0) { throw "MiniPCへSSH接続できません: $SshHost" }
  if ($localHead -and $remoteHead -and $localHead.Trim() -ne $remoteHead.Trim()) {
    $warningKey = $localHead.Trim() + '|' + $remoteHead.Trim()
    $warningFile = Join-Path $repo 'logs\minipc-version-warning.local.txt'
    $previous = if (Test-Path -LiteralPath $warningFile) { (Get-Content -Raw -LiteralPath $warningFile).Trim() } else { '' }
    if ($previous -ne $warningKey) {
      Write-Warning ("Git版が異なります。ノートPC={0} MiniPC={1}。入出力schemaの互換性を確認してください。" -f $localHead.Trim(), $remoteHead.Trim())
      $warningKey | Set-Content -LiteralPath $warningFile -Encoding ascii
    }
  }
}

function Require-AppointmentId {
  if ($AppointmentId -le 0) { throw "$Operation には -AppointmentId が必要です" }
}

function Require-CareerMeetingId {
  if ($CareerMeetingId -le 0) { throw "$Operation には -CareerMeetingId が必要です" }
}

Warn-VersionDifference
$remoteSync = 'cd ~/' + $RemoteRepoName + '/sync && '

switch ($Operation) {
  'agenda' {
    Invoke-Remote ($remoteSync + 'npx tsx scripts/db-agenda.ts')
    return
  }
  'appointment-times' {
    Require-AppointmentId
    # MiniPCのブランチがノートPCより古く appointment-times.mjs をまだ持たない場合でも、
    # 共通のdb-agenda JSONから同じ情報を取り出せる。手動録音の補完対象は直近予定なのでagenda範囲内で足りる。
    $agendaLines = @(Invoke-RemoteCapture ($remoteSync + 'npx tsx scripts/db-agenda.ts'))
    $agendaJson = $agendaLines | Where-Object { $_ -match '^\s*\[' } | Select-Object -Last 1
    if (-not $agendaJson) { throw 'MiniPCのagenda JSONを取得できませんでした' }
    $appointment = @($agendaJson | ConvertFrom-Json) | Where-Object { [int]$_.id -eq $AppointmentId } | Select-Object -First 1
    if (-not $appointment) { throw "予定 $AppointmentId はMiniPCの直近agendaにありません" }
    [ordered]@{ startIso = $appointment.startIso; endIso = $appointment.endIso } | ConvertTo-Json -Compress
    return
  }
  'calendar-conflicts' {
    $isoPattern = '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})$'
    if ($StartIso -notmatch $isoPattern -or $EndIso -notmatch $isoPattern) {
      throw 'calendar-conflicts にはタイムゾーン付きISO形式の -StartIso / -EndIso が必要です'
    }
    if ($ExcludeAppointmentId -lt 0) { throw 'ExcludeAppointmentId は0以上で指定してください' }

    # 候補提示・確定の直前は、Google CalendarをMiniPCの正本DBへ同期してから判定する。
    Invoke-Remote ('cd ~/' + $RemoteRepoName +
      ' && powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/calendar-sync.ps1')

    $conflictCommand = $remoteSync + "npx tsx scripts/db-appointment.ts conflicts '$StartIso' '$EndIso'"
    if ($ExcludeAppointmentId -gt 0) { $conflictCommand += ' ' + $ExcludeAppointmentId }
    $conflictOutput = @(& ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost $conflictCommand)
    $conflictExit = $LASTEXITCODE
    $conflictOutput | Write-Output
    if ($conflictExit -notin @(0, 2, 3)) {
      throw "MiniPC上の空き判定に失敗しました(exit=$conflictExit)"
    }
    return
  }
  'meeting-ensure' {
    Require-AppointmentId
    Invoke-Remote ($remoteSync + 'npx tsx scripts/db-meeting-run.ts ensure ' + $AppointmentId)
    return
  }
  'meeting-transition' {
    Require-AppointmentId
    if (-not $State) { throw 'meeting-transition には -State が必要です' }
    $command = $remoteSync + 'npx tsx scripts/db-meeting-run.ts transition ' + $AppointmentId + ' ' + $State
    if ($Message) {
      if ($Message.Contains("'")) { throw "Message に単一引用符は使えません" }
      $command += " '$Message'"
    }
    Invoke-Remote $command
    return
  }
  'meeting-done' {
    Require-AppointmentId
    Invoke-Remote ($remoteSync + 'npx tsx scripts/db-meeting-done.ts ' + $AppointmentId + ' && npx tsx scripts/db-snapshot.ts')
    return
  }
  'career-meeting-ensure' {
    Require-CareerMeetingId
    Invoke-Remote ($remoteSync + 'npx tsx scripts/db-career-meeting-run.ts ensure ' + $CareerMeetingId)
    return
  }
  'career-meeting-transition' {
    Require-CareerMeetingId
    if (-not $State) { throw 'career-meeting-transition には -State が必要です' }
    $command = $remoteSync + 'npx tsx scripts/db-career-meeting-run.ts transition ' + $CareerMeetingId + ' ' + $State
    if ($Message) {
      if ($Message.Contains("'")) { throw "Message に単一引用符は使えません" }
      $command += " '$Message'"
    }
    Invoke-Remote $command
    return
  }
  'career-meeting-done' {
    Require-CareerMeetingId
    Invoke-Remote ($remoteSync + 'npx tsx scripts/db-career-meeting-done.ts ' + $CareerMeetingId + ' && npx tsx scripts/db-snapshot.ts')
    return
  }
}

if ($Operation -like 'email-*') {
  if ($RunId -notmatch '^[A-Za-z0-9:._-]+$') { throw "$Operation には安全な -RunId が必要です" }
  $emailCommand = $Operation.Substring('email-'.Length)
  if ($emailCommand -eq 'status') {
    Invoke-Remote ($remoteSync + 'npx tsx scripts/third-party-email.ts status --run-id ' + $RunId)
    return
  }
  if (-not $InputPath) { throw "$Operation には -InputPath が必要です" }
  $resolvedEmailInput = (Resolve-Path -LiteralPath $InputPath).Path
  if ([IO.Path]::GetExtension($resolvedEmailInput).ToLowerInvariant() -ne '.json') { throw '転送できる入力はJSONだけです' }
  if ((Get-Item -LiteralPath $resolvedEmailInput).Length -gt 1MB) { throw 'メールaction JSONが1MBを超えています' }
  $remoteEmailName = 'email-' + [guid]::NewGuid().ToString('N') + '.json'
  $remoteEmailRel = 'logs/handoff-in/' + $remoteEmailName
  Invoke-Remote ('cd ~/' + $RemoteRepoName + ' && mkdir -p logs/handoff-in')
  & scp -o BatchMode=yes -o ConnectTimeout=10 -q -- $resolvedEmailInput ($SshHost + ':' + $RemoteRepoName + '/' + $remoteEmailRel)
  if ($LASTEXITCODE -ne 0) { throw "MiniPCへのメールaction転送に失敗しました: $Operation" }
  $emailExit = 0
  try {
    & ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost `
      ($remoteSync + 'npx tsx scripts/third-party-email.ts ' + $emailCommand + ' --run-id ' + $RunId + ' --action ../' + $remoteEmailRel)
    $emailExit = $LASTEXITCODE
  } finally {
    & ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost ('cd ~/' + $RemoteRepoName + ' && rm -f ' + $remoteEmailRel) 2>$null | Out-Null
  }
  if ($emailExit -ne 0) { throw "MiniPCのメールworkflowに失敗しました(exit=$emailExit): $Operation" }
  return
}

$applyScripts = @{
  'apply-selection'  = 'db-apply.ts'
  'apply-submission' = 'db-apply-submission.ts'
  'apply-mail'       = 'db-apply-mail.ts'
  'apply-calendar'   = 'db-apply-calendar.ts'
  'apply-career-calendar' = 'db-apply-career-calendar.ts'
  'apply-research'   = 'db-apply-research.ts'
  'apply-person'     = 'db-apply-person.ts'
}
if (-not $applyScripts.ContainsKey($Operation)) { throw "未対応の操作です: $Operation" }
if (-not $InputPath) { throw "$Operation には -InputPath が必要です" }
$resolvedInput = (Resolve-Path -LiteralPath $InputPath).Path
if ([IO.Path]::GetExtension($resolvedInput).ToLowerInvariant() -ne '.json') { throw '転送できる入力はJSONだけです' }
$inputInfo = Get-Item -LiteralPath $resolvedInput
if ($inputInfo.Length -gt 10MB) { throw 'JSON入力が10MBを超えています。意図しないファイルを選んでいないか確認してください。' }

# ファイル名や内容をSSHコマンド行へ載せない。転送先は生成したASCII名に固定する。
$remoteName = 'laptop-' + [guid]::NewGuid().ToString('N') + '.json'
$remoteRel = 'logs/handoff-in/' + $remoteName
Invoke-Remote ('cd ~/' + $RemoteRepoName + ' && mkdir -p logs/handoff-in')
& scp -o BatchMode=yes -o ConnectTimeout=10 -q -- $resolvedInput ($SshHost + ':' + $RemoteRepoName + '/' + $remoteRel)
if ($LASTEXITCODE -ne 0) { throw "MiniPCへのJSON転送に失敗しました: $Operation" }

$scriptName = $applyScripts[$Operation]
# 活動ログも正本側へ残し、同じsnapshotへ含める。日本語をSSHの引用規則から切り離すため
# EncodedCommandで渡す。活動ログだけが失敗しても、DB反映後のsnapshotは必ず実行する。
$activityCommand = @"
`$repo = Join-Path ([Environment]::GetFolderPath('UserProfile')) '$RemoteRepoName'
& (Join-Path `$repo 'scripts\log-activity.ps1') -By 'laptop-codex' -Action 'ノートPCから正本DBへ反映: $Operation' -Why 'ブラウザ・添付作業の結果をMiniPCの正本へ集約するため' -How '許可リスト付きSSH CLIでJSON転送、DB反映、snapshotを連続実行' -Link 'logs/activity-log.jsonl' -Result '成功'
"@
$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($activityCommand))
$applyCommand = $remoteSync + 'npx tsx scripts/' + $scriptName + ' ../' + $remoteRel +
  ' && (powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand ' + $encoded + ' || true) && npx tsx scripts/db-snapshot.ts'
$applyExit = 0
try {
  & ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost $applyCommand
  $applyExit = $LASTEXITCODE
} finally {
  # 成否にかかわらず転送JSONを残さない。DB側CLIはトランザクションで失敗時に巻き戻す。
  & ssh -o BatchMode=yes -o ConnectTimeout=10 $SshHost ('cd ~/' + $RemoteRepoName + ' && rm -f ' + $remoteRel) 2>$null | Out-Null
}
if ($applyExit -ne 0) {
  throw "MiniPCでDB反映またはsnapshotに失敗しました(exit=$applyExit): $Operation"
}
