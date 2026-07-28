# katazuku 前夜ブリーフをタスクスケジューラに登録する(1回実行すればよい)
# 毎晩 20:15 に evening-brief.ps1 をheadless実行する(明日の面接・面談がなければ何もしない)。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-evening-brief' -Confirm:$false
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-evening-brief.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At '20:15'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

Register-ScheduledTask -TaskName 'katazuku-evening-brief' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 前夜ブリーフ: 明日の面接・面談の相手情報・前回記録・想定問答を自分宛メールで届ける' `
  -Force | Out-Null

"タスク 'katazuku-evening-brief' を登録しました(毎晩20:15、ウィンドウ非表示で実行)。"
"手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\evening-brief.ps1`""
