# Windows固有の配列・タスク操作を合成コマンドで確認する。実タスクは操作しない。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$global:localLoginFixtureChecks = 0
function Assert-Fixture([bool]$Value, [string]$Message) {
  if (-not $Value) { throw $Message }
  $global:localLoginFixtureChecks += 1
}
$global:localLoginFixtureTask = [pscustomobject]@{
  TaskName = 'katazuku-local-login'
  Settings = [pscustomobject]@{ Enabled = $false }
  Triggers = @([pscustomobject]@{ StartBoundary = '2026-09-08T07:40:00' })
  State = 'Disabled'
}
$global:localLoginFixtureFailure = $false
function Get-ScheduledTask {
  [CmdletBinding()]param([string]$TaskName, [string]$TaskPath)
  Assert-Fixture ($TaskPath -eq '\') 'タスクのフォルダを固定する'
  if ($global:localLoginFixtureTask) { $global:localLoginFixtureTask }
}
function Export-ScheduledTask {
  [CmdletBinding()]param([string]$TaskName, [string]$TaskPath)
  $global:localLoginFixtureTask | ConvertTo-Json -Depth 10 -Compress
}
function New-ScheduledTaskAction {
  [CmdletBinding()]param([string]$Execute, [string]$Argument)
  Assert-Fixture ($Execute -eq 'wscript.exe' -and $Argument.EndsWith('run-local-login.vbs"')) '起動する処理は固定ランチャーだけ'
  [pscustomobject]@{ Execute = $Execute; Argument = $Argument }
}
function New-ScheduledTaskTrigger {
  [CmdletBinding()]param([switch]$Daily, [string]$At)
  Assert-Fixture ([bool]$Daily) '毎日1回の起動にする'
  [pscustomobject]@{ StartBoundary = "2026-09-08T${At}:00" }
}
function New-ScheduledTaskSettingsSet {
  [CmdletBinding()]param([switch]$StartWhenAvailable, [switch]$WakeToRun, [string]$MultipleInstances, [TimeSpan]$ExecutionTimeLimit,
    [switch]$AllowStartIfOnBatteries, [switch]$DontStopIfGoingOnBatteries)
  Assert-Fixture ($StartWhenAvailable -and $WakeToRun -and $AllowStartIfOnBatteries -and $DontStopIfGoingOnBatteries) '遅延実行とバッテリー実行を維持する'
  Assert-Fixture ($MultipleInstances -eq 'IgnoreNew' -and $ExecutionTimeLimit.TotalMinutes -eq 20) '多重起動と実行時間を制限する'
  [pscustomobject]@{ Enabled = $true }
}
function Register-ScheduledTask {
  [CmdletBinding()]param([string]$TaskName, [string]$TaskPath, $Action, $Trigger, $Settings, [string]$Description, [switch]$Force, [string]$Xml)
  Assert-Fixture ($TaskName -eq 'katazuku-local-login' -and $TaskPath -eq '\') '固定の自動ログインタスクだけを更新する'
  if ($Xml) { $global:localLoginFixtureTask = $Xml | ConvertFrom-Json; return }
  $global:localLoginFixtureTask = [pscustomobject]@{
    TaskName = $TaskName; Settings = $Settings; Triggers = @($Trigger)
    State = if ($Settings.Enabled) { 'Ready' } else { 'Disabled' }
  }
  if ($global:localLoginFixtureFailure) { $global:localLoginFixtureFailure = $false; throw '合成の保存後エラー' }
}
function Unregister-ScheduledTask {
  [CmdletBinding(SupportsShouldProcess)]param([string]$TaskName, [string]$TaskPath)
  $global:localLoginFixtureTask = $null
}

$scheduleScript = Join-Path $PSScriptRoot 'schedule.ps1'
$read = (& $scheduleScript | ConvertFrom-Json)
Assert-Fixture (-not $read.enabled -and $read.time -eq '07:40') '停止中の現在状態を読み取る'
$saved = (& $scheduleScript -Operation Apply -At '09:17' | ConvertFrom-Json)
Assert-Fixture ($saved.enabled -and $saved.time -eq '09:17') 'GUIの時刻と有効状態をWindows操作へ渡す'
$stopped = (& $scheduleScript -Operation Apply -At '23:59' -Disabled | ConvertFrom-Json)
Assert-Fixture (-not $stopped.enabled -and $stopped.time -eq '23:59') 'タスクを停止した状態で登録できる'
$global:localLoginFixtureFailure = $true
$failed = $false
try { & $scheduleScript -Operation Apply -At '10:00' | Out-Null } catch { $failed = $true }
Assert-Fixture $failed '保存エラーを成功として返さない'
$restored = (& $scheduleScript | ConvertFrom-Json)
Assert-Fixture (-not $restored.enabled -and $restored.time -eq '23:59') '保存後のエラーでも元のタスク定義へ復元する'

# 本物のnodeやChromeを呼ばず、日次オーケストレータの引数を確認する。
function Get-Command {
  [CmdletBinding()]param([string]$Name)
  Assert-Fixture ($Name -eq 'node') 'ランナーの実行ファイルを固定する'
  [pscustomobject]@{ Source = 'Invoke-SettingsFixtureNode' }
}
function Invoke-SettingsFixtureNode {
  $global:LASTEXITCODE = 0
  if ($args[0].EndsWith('settings.mjs')) { $global:localLoginFixtureJson; return }
  $global:localLoginFixtureCalls += ,@($args)
}
$dailyScript = Join-Path $PSScriptRoot 'daily-login.ps1'
foreach ($json in @('[]', '["sso"]', '["sso","password"]')) {
  $global:localLoginFixtureJson = $json
  $global:localLoginFixtureCalls = @()
  & $dailyScript | Out-Null
  $ids = ConvertFrom-Json -InputObject $json
  Assert-Fixture ($global:localLoginFixtureCalls.Count -eq $ids.Count) '選択された件数だけを実行する（0件・1件・2件）'
  for ($index = 0; $index -lt $ids.Count; $index++) {
    $call = $global:localLoginFixtureCalls[$index]
    Assert-Fixture ($call.Count -eq 4 -and $call[1] -eq '--portal' -and $call[2] -eq $ids[$index] -and $call[3] -eq '--scheduled') 'サービスを1件ずつ渡し、実行直前にも設定を再検査する'
  }
}
"Windows設定連携: $global:localLoginFixtureChecks 項目成功（実タスク変更なし）"
