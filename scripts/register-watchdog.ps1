# katazuku watchdog — 番犬をタスクスケジューラに登録する(1回実行すればよい)
# 毎日 08:35 から 4時間おき(08:35/12:35/16:35/20:35)に watchdog.ps1 をheadless実行する。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-watchdog' -Confirm:$false
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-watchdog.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At '08:35'
$rep = (New-ScheduledTaskTrigger -Once -At '08:35' `
  -RepetitionInterval (New-TimeSpan -Hours 4) `
  -RepetitionDuration (New-TimeSpan -Hours 12)).Repetition
$trigger.Repetition = $rep

# INFRA.mdの教訓: バッテリー駆動でも起動し、電源切替で止めない
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName 'katazuku-watchdog' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 番犬: 定常タスクの活動ログ鮮度とClaude/Codex健康状態を監視し、停止時のみトースト+alert通知(AI非依存)' `
  -Force | Out-Null

"タスク 'katazuku-watchdog' を登録しました(毎日08:35〜20:35、4時間おき、ウィンドウ非表示で実行)。"
"手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\watchdog.ps1`" -TestToast"
