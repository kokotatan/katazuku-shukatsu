$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (Test-Path -LiteralPath (Join-Path $repo '.katazuku-satellite')) { throw 'Register the bridge on the canonical PC.' }
$launcher = Join-Path $PSScriptRoot 'run-spark-bridge.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName 'katazuku-spark-bridge' -Action $action -Trigger $trigger -Settings $settings -Description 'Spark OAuth gateway outbound relay' -Force | Out-Null
Start-ScheduledTask -TaskName 'katazuku-spark-bridge'
Write-Output 'katazuku-spark-bridge registered'
