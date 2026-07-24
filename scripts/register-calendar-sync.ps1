# calendar-syncを30分毎に登録する。
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-calendar-sync.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Daily -At '00:03'
$repeat = (New-ScheduledTaskTrigger -Once -At '00:03' -RepetitionInterval (New-TimeSpan -Minutes 30) -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
$trigger.Repetition = $repeat
# 既定では「バッテリー駆動なら起動しない/バッテリーに切り替わったら停止」になり、
# ノートPCを電源から外した瞬間に無言で止まる(2026-07-24に全タスクで発覚)。明示的に許可する。
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 25) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'katazuku-calendar-sync' -Action $action -Trigger $trigger -Settings $settings -Description 'Google Calendarを正本DBのappointmentへ30分毎に同期' -Force | Out-Null
Write-Output '登録完了: katazuku-calendar-sync'
