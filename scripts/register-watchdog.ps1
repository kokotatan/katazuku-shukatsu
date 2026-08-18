# katazuku watchdog — 番犬をタスクスケジューラに登録する(1回実行すればよい)
# 毎日 08:35 から 4時間おきに24時間、watchdog.ps1 をheadless実行する(夜間も監視。夜間の枠切れ・停止は翌朝まで残るため)。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-watchdog' -Confirm:$false
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-watchdog.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At '08:35'
$rep = (New-ScheduledTaskTrigger -Once -At '08:35' `
  -RepetitionInterval (New-TimeSpan -Hours 4) `
  -RepetitionDuration (New-TimeSpan -Hours 24)).Repetition
$trigger.Repetition = $rep

# INFRA.mdの教訓: バッテリー駆動でも起動し、電源切替で止めない
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask -TaskName 'katazuku-watchdog' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 番犬: 定常タスクの活動ログ鮮度とClaude/Codex健康状態を監視し、停止時のみトースト+alert通知(AI非依存)' `
  -Force | Out-Null

# 実機の登録内容を検算する。2026-08-18: スクリプトは24時間なのに実タスクは PT12H のままで、
# 20:35〜翌08:35 の12時間が無監視になり、毎朝「番犬自身が止まっていた」と誤報していた。
$dur = (Get-ScheduledTask -TaskName 'katazuku-watchdog').Triggers[0].Repetition.Duration
if ($dur -notin @('PT24H', 'P1D')) { Write-Warning ("繰り返し時間が {0} になっています(期待: PT24H/P1D)。夜間が無監視になります" -f $dur) }

"タスク 'katazuku-watchdog' を登録しました(毎日08:35から4時間おきに24時間、ウィンドウ非表示で実行)。"
"手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\watchdog.ps1`" -TestToast"
