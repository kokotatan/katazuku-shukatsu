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
    'agenda', 'appointment-times',
    'meeting-ensure', 'meeting-transition', 'meeting-done',
    'apply-selection', 'apply-submission', 'apply-mail', 'apply-calendar',
    'apply-research', 'apply-person'
  )]
  [string]$Operation,
  [string]$InputPath = '',
  [int]$AppointmentId = 0,
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
}

$applyScripts = @{
  'apply-selection'  = 'db-apply.ts'
  'apply-submission' = 'db-apply-submission.ts'
  'apply-mail'       = 'db-apply-mail.ts'
  'apply-calendar'   = 'db-apply-calendar.ts'
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
