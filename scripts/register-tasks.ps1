# katazuku: register the autopilot workflows in Windows Task Scheduler (run once, no admin rights needed).
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1 -Only mail-watch,asa
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1 -Unregister
#
# Every task runs scripts\run-workflow.vbs, which starts "node tsx scripts/workflow.ts <name>" with no window.
# Tasks run only while you are logged on (they need your own Claude Code / Codex login).
# -StartWhenAvailable runs a missed trigger after the PC wakes up, so a sleeping laptop catches up.
# Comments are ASCII on purpose: Windows PowerShell 5.1 misreads UTF-8 files without BOM.
param(
  [string[]]$Only = @(),
  [switch]$Unregister
)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-workflow.vbs'

# name, first start time, repetition (minutes, 0 = once a day), repetition duration (hours), time limit (minutes)
$schedule = @(
  @{ Name = 'mail-watch';    At = '07:15'; EveryMinutes = 60;  ForHours = 15; LimitMinutes = 40 },
  @{ Name = 'daily-sync';    At = '08:23'; EveryMinutes = 0;   ForHours = 0;  LimitMinutes = 90 },
  @{ Name = 'asa';           At = '09:00'; EveryMinutes = 0;   ForHours = 0;  LimitMinutes = 75 },
  @{ Name = 'calendar-sync'; At = '00:00'; EveryMinutes = 30;  ForHours = 24; LimitMinutes = 25 },
  @{ Name = 'evening-brief'; At = '20:15'; EveryMinutes = 0;   ForHours = 0;  LimitMinutes = 30 },
  @{ Name = 'watchdog';      At = '00:45'; EveryMinutes = 240; ForHours = 24; LimitMinutes = 10 }
)
if ($Only.Count -gt 0) { $schedule = @($schedule | Where-Object { $Only -contains $_.Name }) }

foreach ($item in $schedule) {
  $taskName = 'katazuku-' + $item.Name
  if ($Unregister) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Output ('removed: ' + $taskName)
    continue
  }
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}" {1}' -f $launcher, $item.Name)
  $trigger = New-ScheduledTaskTrigger -Daily -At $item.At
  if ($item.EveryMinutes -gt 0) {
    $repeat = New-ScheduledTaskTrigger -Once -At $item.At `
      -RepetitionInterval (New-TimeSpan -Minutes $item.EveryMinutes) `
      -RepetitionDuration (New-TimeSpan -Hours $item.ForHours)
    $trigger.Repetition = $repeat.Repetition
  }
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes $item.LimitMinutes) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
  Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
    -Description ('katazuku autopilot: ' + $item.Name + ' (logs in logs\)') -Force | Out-Null
  Write-Output ('registered: ' + $taskName + ' at ' + $item.At)
}
if (-not $Unregister) {
  Write-Output 'Test one now: schtasks /run /tn katazuku-watchdog   (then read logs\watchdog-*.log)'
}
