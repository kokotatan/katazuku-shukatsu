# katazuku-meeting-opener をタスクスケジューラに登録する(1回だけ実行)
# 5分おきに open-meeting-urls.ps1 を起動し、10分前の会議URLを既定ブラウザで開く。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-meeting-opener' -Confirm:$false

$script = Join-Path $PSScriptRoot 'open-meeting-urls.ps1'
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $script)

# 毎日8:00開始で、15時間(=23:00まで)5分おきに繰り返す
$trigger = New-ScheduledTaskTrigger -Daily -At '08:00'
$rep = (New-ScheduledTaskTrigger -Once -At '08:00' `
  -RepetitionInterval (New-TimeSpan -Minutes 5) `
  -RepetitionDuration (New-TimeSpan -Hours 15)).Repetition
$trigger.Repetition = $rep

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -StartWhenAvailable -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName 'katazuku-meeting-opener' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'careerカレンダーの10分前会議URLを既定ブラウザで開く(Haiku)' -Force

Write-Host '登録しました: katazuku-meeting-opener (毎日8:00-23:00、5分おき)'
