# meeting-autopilotを5分毎に登録する。旧meeting-openerは無効化する。
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-meeting-autopilot.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Daily -At '00:01'
$repeat = (New-ScheduledTaskTrigger -Once -At '00:01' -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
$trigger.Repetition = $repeat
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName 'katazuku-meeting-autopilot' -Action $action -Trigger $trigger -Settings $settings -Description 'DB予定を開き、録音と議事録を予定ID単位で自動実行' -Force | Out-Null
Disable-ScheduledTask -TaskName 'katazuku-meeting-opener' -ErrorAction SilentlyContinue | Out-Null
Write-Output '登録完了: katazuku-meeting-autopilot'
