$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if (Test-Path -LiteralPath (Join-Path $repo '.katazuku-satellite')) { throw '定常workerは正本PCへ登録してください' }
$launcher = Join-Path $PSScriptRoot 'run-spark-worker.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'katazuku-spark-worker' -Action $action -Trigger $trigger -Settings $settings -Description 'Spark依頼の送信と結果回収。空キュー時はモデル呼出なし。認証境界は停止。' -Force | Out-Null
Write-Output 'katazuku-spark-workerを5分間隔で登録しました'
