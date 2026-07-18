# katazuku daily-sync — 毎朝のメール分析・DB同期をタスクスケジューラに登録する(1回実行すればよい)
# 毎朝8:23にheadlessで daily-sync.ps1 を実行する(katazuku asa の9:00より先に受信箱を整えておく)。
# 8:23にPCが起きていなければ、次に使える時点で実行する(StartWhenAvailable)。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-daily-sync' -Confirm:$false
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-daily-sync.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At '08:23'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 1)

Register-ScheduledTask -TaskName 'katazuku-daily-sync' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 毎日同期: メール分析→正本DB更新→アプリ反映→シートミラー→受信トレイ整理(ログは logs/sync-*.log)' `
  -Force | Out-Null

"タスク 'katazuku-daily-sync' を登録しました(毎朝8:23、ウィンドウ非表示で実行)。"
"手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\daily-sync.ps1`""
