# katazuku local-login — 毎日ログイン(継続ログインで優遇オファーを狙う)をタスクスケジューラに登録する。
# 1回実行すればよい。毎朝7:40にheadlessで各ポータルへログインを試みる(daily-syncの8:23より前に温めておく)。
# 7:40にPCが起きていなければ、次に使える時点で実行する(StartWhenAvailable)。
# 前提: 事前に本人が store-credential.ps1 で credential-store\<portal>.json を作っていること。
#       レコードの無いポータルはランナー側で安全にskipされる。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-local-login' -Confirm:$false
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-local-login.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At '07:40'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName 'katazuku-local-login' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 毎日ログイン: LabBase / 外資就活へ隔離Chromeプロファイルで継続ログイン(秘密値入力はbroker、ログは logs/local-login-*.log)' `
  -Force | Out-Null

"タスク 'katazuku-local-login' を登録しました(毎朝7:40、ウィンドウ非表示で実行)。"
"手動テスト(1ポータル): node `"$PSScriptRoot\local-login\daily-login.mjs`" --portal labbase --headful"
