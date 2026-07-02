# katazuku asa — 朝の決裁ルーチンをタスクスケジューラに登録する(1回実行すればよい)
# 毎朝9:00にPowerShellウィンドウを開き、claude対話セッションで決裁を提示する。
# 9:00にPCが起きていなければ、次に使える時点で実行する(StartWhenAvailable)。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-asa' -Confirm:$false
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoExit -ExecutionPolicy Bypass -Command `"& '$repo\scripts\katazuku.ps1' asa`""

$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'

# 実行時間の上限なし(決裁ウィンドウを開いたままにしてもタスク側から殺さない)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero)

Register-ScheduledTask -TaskName 'katazuku-asa' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 朝の決裁ルーチン: メール分類・返信下書き・カレンダー登録・シート突合を自動で済ませ、決裁だけを提示する' `
  -Force | Out-Null

"タスク 'katazuku-asa' を登録しました(毎朝9:00、ログオン中のみウィンドウ表示)。"
"手動テスト: Start-ScheduledTask -TaskName 'katazuku-asa'"
