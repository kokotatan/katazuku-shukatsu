$ErrorActionPreference = 'Stop'

$launcher = Join-Path $PSScriptRoot 'run-calendar-sync.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Daily -At '00:03'
$repeatTrigger = New-ScheduledTaskTrigger -Once -At '00:03' `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Days 1)
$trigger.Repetition = $repeatTrigger.Repetition
$settings = New-ScheduledTaskSettingsSet `
  -StartWhenAvailable `
  -WakeToRun `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 4) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries

Register-ScheduledTask `
  -TaskName 'katazuku-calendar-sync' `
  -Action $action `
  -Trigger $trigger `
  -Settings $settings `
  -Description 'Sync Google Calendar to the canonical appointment DB every 5 minutes' `
  -Force | Out-Null

Write-Output 'Registered: katazuku-calendar-sync'
