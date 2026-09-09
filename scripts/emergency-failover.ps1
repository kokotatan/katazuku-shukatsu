[CmdletBinding()]
param(
  [ValidateSet('activate', 'install-guard', 'guard', 'status', 'pause', 'deactivate')]
  [string]$Operation = 'status',
  [string]$SourceDb = '',
  [datetime]$HardExpiresAt = (Get-Date).Date.AddDays(11),
  [switch]$EnableScheduledTasks,
  [switch]$ForceOffline
)

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $repo 'sync'
$leasePath = Join-Path $repo '.katazuku-emergency-canonical.local.json'
$satellitePath = Join-Path $repo '.katazuku-satellite'
$canonicalDb = Join-Path $repo 'data\katazuku.db'
$guardTask = 'katazuku-failover-guard'
$guardLogDir = Join-Path $repo 'logs\failover'
if (-not (Test-Path -LiteralPath $guardLogDir)) { New-Item -ItemType Directory -Path $guardLogDir -Force | Out-Null }
$guardLog = Join-Path $guardLogDir 'guard.local.log'
trap {
  ("{0} FATAL {1}`r`n{2}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_.Exception.Message, $_.ScriptStackTrace) |
    Out-File -LiteralPath $guardLog -Append -Encoding utf8
  exit 1
}
$temporaryTasks = @(
  'katazuku-calendar-sync',
  'katazuku-daily-sync',
  'katazuku-mail-watch',
  'katazuku-asa',
  'katazuku-evening-brief',
  'katazuku-watchdog'
)
. (Join-Path $PSScriptRoot 'katazuku-role.ps1')

function Read-Lease {
  if (-not (Test-Path -LiteralPath $leasePath)) { return $null }
  return Get-Content -LiteralPath $leasePath -Raw -Encoding UTF8 | ConvertFrom-Json
}

function Write-Lease($lease) {
  $json = $lease | ConvertTo-Json -Depth 8
  [IO.File]::WriteAllText($leasePath, $json, (New-Object Text.UTF8Encoding($false)))
}

function Get-MiniPcConnectivity {
  $tailscaleExe = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
  $sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
  try {
    if (-not (Test-Path -LiteralPath $tailscaleExe)) { throw 'tailscale.exe not found' }
    $tailscale = & $tailscaleExe status --json 2>$null | ConvertFrom-Json
    $peer = $tailscale.Peer.PSObject.Properties.Value |
      Where-Object { $_.HostName -ieq 'KOKOTATANPC' } | Select-Object -First 1
    if ($peer) {
      return [pscustomobject]@{
        State = if ($peer.Online) { 'online' } else { 'offline' }
        LastSeen = [string]$peer.LastSeen
        Evidence = 'tailscale'
      }
    }
    ("{0} tailscale peer missing" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) |
      Out-File -LiteralPath $guardLog -Append -Encoding utf8
  } catch {
    $detail = [string]$_.Exception.Message
    if ($detail.Length -gt 300) { $detail = $detail.Substring(0, 300) }
    ("{0} tailscale failed: {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $detail) |
      Out-File -LiteralPath $guardLog -Append -Encoding utf8
  }

  if (-not (Test-Path -LiteralPath $sshExe)) {
    return [pscustomobject]@{ State = 'unknown'; LastSeen = ''; Evidence = 'none' }
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $sshOutput = & $sshExe -o BatchMode=yes -o ConnectTimeout=5 -o ConnectionAttempts=1 KOKOTATANPC hostname 2>&1
  $sshExit = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($sshExit -eq 0 -and (($sshOutput | Out-String).Trim() -ieq 'KOKOTATANPC')) {
    return [pscustomobject]@{ State = 'online'; LastSeen = ''; Evidence = 'ssh' }
  }
  return [pscustomobject]@{ State = 'unknown'; LastSeen = ''; Evidence = 'none' }
}

function Disable-TemporaryTasks($lease, [string]$reason) {
  $names = @($lease.temporarilyEnabledTasks)
  foreach ($name in $names) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) { $task | Disable-ScheduledTask | Out-Null }
  }
  $guard = Get-ScheduledTask -TaskName $guardTask -ErrorAction SilentlyContinue
  if ($guard) { $guard | Disable-ScheduledTask | Out-Null }
  Write-Output ("ノートPC側の暫定タスクを停止: {0}" -f $reason)
}

function Pause-Lease([string]$reason) {
  $lease = Read-Lease
  if (-not $lease) { return }
  $lease.status = 'paused'
  $lease | Add-Member -NotePropertyName pausedAt -NotePropertyValue ([DateTimeOffset]::Now.ToString('o')) -Force
  $lease | Add-Member -NotePropertyName pauseReason -NotePropertyValue $reason -Force
  Write-Lease $lease
  Disable-TemporaryTasks $lease $reason
}

function Register-GuardTask {
  $guardLauncher = Join-Path $PSScriptRoot 'run-failover-guard.vbs'
  if (-not (Test-Path -LiteralPath $guardLauncher)) {
    throw ("緊急正本ガードの非表示ランチャーがありません: {0}" -f $guardLauncher)
  }
  $argument = ('"{0}"' -f $guardLauncher)
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $argument -WorkingDirectory $repo
  # 登録時刻が当日の固定開始時刻を過ぎていると翌日まで動かないため、常に1分後開始のOnceを使う。
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
  $repeat = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 14)).Repetition
  $trigger.Repetition = $repeat
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 2) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $guardTask -Action $action -Trigger $trigger -Settings $settings `
    -Description 'MiniPC障害中の緊急正本リースを5分ごとに更新し、MiniPC復帰時はノートPC書込を止める' `
    -Force | Out-Null
}

if ($Operation -eq 'install-guard') {
  if (-not (Read-Lease)) { throw '緊急正本リースがありません。' }
  Register-GuardTask
  Write-Output '緊急正本ガードを再登録しました。'
  exit 0
}

if ($Operation -eq 'status') {
  $state = Get-KatazukuEmergencyCanonicalState -RepositoryRoot $repo
  $connectivity = Get-MiniPcConnectivity
  [pscustomobject]@{
    operationalRole = Get-KatazukuOperationalRole -RepositoryRoot $repo
    leaseActive = $state.Active
    leaseReason = $state.Reason
    lease = $state.Lease
    miniPc = $connectivity
    canonicalDbExists = Test-Path -LiteralPath $canonicalDb
  } | ConvertTo-Json -Depth 8
  exit 0
}

if ($Operation -eq 'guard') {
  $lease = Read-Lease
  if (-not $lease -or $lease.status -ne 'active') { exit 0 }
  $now = [DateTimeOffset]::Now
  if ([DateTimeOffset]::Parse([string]$lease.hardExpiresAt) -le $now) {
    Pause-Lease '緊急正本の最終期限に到達'
    exit 2
  }
  $connectivity = Get-MiniPcConnectivity
  if ($connectivity.State -eq 'online') {
    Pause-Lease ("MiniPC復帰を検知({0})" -f $connectivity.Evidence)
    exit 3
  }
  if ($connectivity.State -ne 'offline') {
    Write-Warning 'MiniPCの状態を確認できないためリースを更新しません。期限到達後は自動的に書込み停止します。'
    exit 4
  }
  $next = $now.AddMinutes(20)
  $hard = [DateTimeOffset]::Parse([string]$lease.hardExpiresAt)
  if ($next -gt $hard) { $next = $hard }
  $lease.leaseExpiresAt = $next.ToString('o')
  $lease | Add-Member -NotePropertyName lastGuardAt -NotePropertyValue $now.ToString('o') -Force
  $lease | Add-Member -NotePropertyName miniPcLastSeen -NotePropertyValue ([string]$connectivity.LastSeen) -Force
  Write-Lease $lease
  ("{0} renewed {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $lease.leaseExpiresAt) |
    Out-File -LiteralPath $guardLog -Append -Encoding utf8
  Write-Output ("緊急正本リースを更新: {0}" -f $lease.leaseExpiresAt)
  exit 0
}

if ($Operation -eq 'pause') {
  Pause-Lease '本人またはagentによる手動停止'
  exit 0
}

if ($Operation -eq 'deactivate') {
  $lease = Read-Lease
  if (-not $lease) { Write-Output '緊急正本リースはありません。'; exit 0 }
  if ($lease.status -eq 'active') { throw '先に -Operation pause でノートPC側の書込みを止めてください。' }
  Disable-TemporaryTasks $lease '緊急正本解除'
  $archiveDir = Join-Path $repo ('logs\failover\' + [string]$lease.failoverId)
  if (-not (Test-Path -LiteralPath $archiveDir)) { New-Item -ItemType Directory -Path $archiveDir -Force | Out-Null }
  $archivePath = Join-Path $archiveDir 'lease-ended.json'
  $lease.status = 'ended'
  $lease | Add-Member -NotePropertyName endedAt -NotePropertyValue ([DateTimeOffset]::Now.ToString('o')) -Force
  [IO.File]::WriteAllText($archivePath, ($lease | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $leasePath -Destination (Join-Path $archiveDir 'lease-local-final.json') -Force
  Write-Output '緊急正本を解除しました。data\katazuku.dbは復旧照合用に残しています。'
  exit 0
}

# activate
if (-not (Test-Path -LiteralPath $satellitePath)) {
  throw '緊急フェイルオーバーは.katazuku-satelliteがあるノートPCだけで実行できます。'
}
$existing = Read-Lease
if ($existing -and $existing.status -eq 'active') { throw '緊急正本リースは既に有効です。' }
$connectivity = Get-MiniPcConnectivity
if ($connectivity.State -ne 'offline' -and -not $ForceOffline) {
  throw ("MiniPC停止を確認できません(state={0})。誤った二重正本を避けるため停止します。" -f $connectivity.State)
}
$now = [DateTimeOffset]::Now
$hard = [DateTimeOffset]$HardExpiresAt
if ($hard -le $now -or $hard -gt $now.AddDays(14)) {
  throw 'HardExpiresAtは現在より後、14日以内にしてください。'
}

if (-not $SourceDb) {
  $candidates = @()
  $candidates += Get-ChildItem -LiteralPath (Join-Path $repo 'data') -Filter 'katazuku.db.retired-laptop-*' -File -ErrorAction SilentlyContinue
  $backupDir = Join-Path $repo 'logs\db-backup-from-minipc'
  if (Test-Path -LiteralPath $backupDir) {
    $candidates += Get-ChildItem -LiteralPath $backupDir -Filter '*.db' -File -ErrorAction SilentlyContinue
  }
  $source = $candidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
  if (-not $source) { throw '復旧元DBがありません。-SourceDbで明示してください。' }
  $SourceDb = $source.FullName
}
$SourceDb = (Resolve-Path -LiteralPath $SourceDb).Path

Push-Location $sync
try {
  $checkText = & npx.cmd tsx scripts/db-failover-check.ts $SourceDb
  if ($LASTEXITCODE -ne 0) { throw '復旧元DBの整合性確認に失敗しました。' }
  $check = ($checkText | Select-Object -Last 1) | ConvertFrom-Json
} finally { Pop-Location }

$failoverId = 'notebook-' + $now.ToString('yyyyMMdd-HHmmss')
$checkpointDir = Join-Path $repo ('logs\failover\' + $failoverId)
New-Item -ItemType Directory -Path $checkpointDir -Force | Out-Null
Copy-Item -LiteralPath $SourceDb -Destination (Join-Path $checkpointDir 'source.db') -Force
if (Test-Path -LiteralPath $canonicalDb) {
  Copy-Item -LiteralPath $canonicalDb -Destination (Join-Path $checkpointDir 'previous-local-canonical.db') -Force
}
Copy-Item -LiteralPath $SourceDb -Destination $canonicalDb -Force

$enabled = @()
if ($EnableScheduledTasks) {
  foreach ($name in $temporaryTasks) {
    $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    if ($task) { $enabled += $name }
  }
}
$lease = [ordered]@{
  schemaVersion = 1
  status = 'active'
  failoverId = $failoverId
  host = [Environment]::MachineName
  canonicalHost = 'KOKOTATANPC'
  sourceDatabaseId = [string]$check.databaseId
  sourcePath = $SourceDb
  activatedAt = $now.ToString('o')
  leaseExpiresAt = $now.AddMinutes(20).ToString('o')
  hardExpiresAt = $hard.ToString('o')
  reason = 'MiniPC unreachable; notebook emergency canonical'
  miniPcLastSeen = [string]$connectivity.LastSeen
  temporarilyEnabledTasks = $enabled
  checkpointDirectory = $checkpointDir
}
Write-Lease $lease

$env:KATAZUKU_DB = $canonicalDb
$env:KATAZUKU_DB_ROLE = 'canonical'
Push-Location $sync
try {
  $context = & npx.cmd tsx scripts/db-appointment.ts context
  if ($LASTEXITCODE -ne 0) { throw '緊急正本のcontext確認に失敗しました。' }
} finally { Pop-Location }
Register-GuardTask
foreach ($name in $enabled) {
  Get-ScheduledTask -TaskName $name -ErrorAction Stop | Enable-ScheduledTask | Out-Null
}

Write-Output ("緊急正本を有効化: {0}" -f $failoverId)
Write-Output ("復旧元: {0}" -f $SourceDb)
Write-Output ("最終期限: {0}" -f $lease.hardExpiresAt)
Write-Output $context
