# katazuku: register interview-autopilot in Windows Task Scheduler (run once, no admin rights needed).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-interview-autopilot.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-interview-autopilot.ps1 -Mode bundle
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-interview-autopilot.ps1 -DryRun
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-interview-autopilot.ps1 -Unregister
#
# Every EveryMinutes minutes the task runs scripts\run-interview-autopilot.vbs, which runs one pass of
# "node tsx scripts/interview-autopilot.ts" with no window. One pass finds recordings that have finished
# (logs\interviews), turns at most one of them into minutes, and exits.
#   -Mode apply   : write the minutes into the canonical DB on this machine (interview:digest --apply)
#   -Mode bundle  : the canonical DB is on another machine; make an interview bundle zip in logs\interview-bundles
#   -Mode minutes : only write minutes and the DB JSON (apply them yourself later)
# The task runs only while you are logged on (it needs your own Claude Code / Codex login).
# MultipleInstances IgnoreNew + the lock file in logs\ prevent double runs; finished recordings are remembered
# in logs\interview-autopilot-state.json, so a recording is never processed twice.
# Comments are ASCII on purpose: Windows PowerShell 5.1 misreads UTF-8 files without BOM.
param(
  [ValidateSet('apply', 'bundle', 'minutes')][string]$Mode = 'apply',
  [ValidateRange(5, 1440)][int]$EveryMinutes = 10,
  [ValidateRange(10, 1440)][int]$LimitMinutes = 180,
  [string]$TaskName = 'katazuku-interview-autopilot',
  [switch]$DryRun,
  [switch]$Unregister
)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-interview-autopilot.vbs'

if ($Unregister) {
  if ($DryRun) { Write-Output ('[dry-run] would remove: ' + $TaskName); return }
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Output ('removed: ' + $TaskName)
  return
}

$modeArgument = switch ($Mode) { 'apply' { ' --apply' } 'bundle' { ' --bundle' } default { '' } }
$argument = ('"{0}"{1}' -f $launcher, $modeArgument)
if ($DryRun) {
  Write-Output ('[dry-run] task:    ' + $TaskName)
  Write-Output ('[dry-run] action:  wscript.exe ' + $argument)
  Write-Output ('[dry-run] every:   ' + $EveryMinutes + ' minutes, time limit ' + $LimitMinutes + ' minutes')
  Write-Output ('[dry-run] preview: npm run interview:autopilot --' + $modeArgument + ' --dry-run')
  return
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument $argument -WorkingDirectory (Split-Path $PSScriptRoot -Parent)
$trigger = New-ScheduledTaskTrigger -Daily -At '00:00'
$repeat = New-ScheduledTaskTrigger -Once -At '00:00' `
  -RepetitionInterval (New-TimeSpan -Minutes $EveryMinutes) `
  -RepetitionDuration (New-TimeSpan -Hours 24)
$trigger.Repetition = $repeat.Repetition
# A long transcription can exceed the interval; IgnoreNew skips the overlapping start instead of queueing it.
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes $LimitMinutes) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
  -Description ('katazuku: turn finished interview recordings into minutes (' + $Mode + ', logs in logs\interview-autopilot.log)') -Force | Out-Null
Write-Output ('registered: ' + $TaskName + ' every ' + $EveryMinutes + ' minutes (' + $Mode + ')')
Write-Output ('Test one now: schtasks /run /tn ' + $TaskName + '   (then read logs\interview-autopilot.log)')
