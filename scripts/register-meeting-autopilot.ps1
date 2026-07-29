# meeting-autopilotを5分毎に登録する。旧meeting-openerは無効化する。
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-meeting-autopilot.vbs'
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Daily -At '00:01'
$repeat = (New-ScheduledTaskTrigger -Once -At '00:01' -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 1)).Repetition
$trigger.Repetition = $repeat
# 上限4分は設計値(本体は5分周期の短命ワーカーで、録音等は子プロセスに任せる)。
# 2026-07-29: 実タスクの上限がWindows既定の72hに戻っており(7/24のバッテリー修正で設定再作成時に欠落)、
# ハングした1回が IgnoreNew と組み合わさって22時間全起動を塞いだ。バッテリー許可とともに明示する。
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 4)
Register-ScheduledTask -TaskName 'katazuku-meeting-autopilot' -Action $action -Trigger $trigger -Settings $settings -Description 'DB予定を開き、録音と議事録を予定ID単位で自動実行' -Force | Out-Null
Disable-ScheduledTask -TaskName 'katazuku-meeting-opener' -ErrorAction SilentlyContinue | Out-Null
Write-Output '登録完了: katazuku-meeting-autopilot'
