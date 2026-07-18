# katazuku asa — 朝のまとめルーチンをタスクスケジューラに登録する(1回実行すればよい)
# 毎朝9:00に無音で asa-auto.ps1 を実行し、きょうやることを本人のGmailへ送る。
# 9:00にPCが起きていなければ、次に使える時点で実行する(StartWhenAvailable)。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-asa' -Confirm:$false
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-asa.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At '09:00'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 2)

Register-ScheduledTask -TaskName 'katazuku-asa' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 朝のまとめルーチン: メール分類・返信下書き・カレンダー登録・DB突合を自動で済ませ、きょうやることを本人のGmailへ送る' `
  -Force | Out-Null

"タスク 'katazuku-asa' を登録しました(毎朝9:00、無音実行→本人のGmailへ配信)。"
"手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File `"$PSScriptRoot\asa-auto.ps1`""
