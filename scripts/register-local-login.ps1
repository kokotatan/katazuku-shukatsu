# katazuku local-login — 毎日ログイン(継続ログインで優遇オファーを狙う)をタスクスケジューラに登録する。
# 1回実行すればよい。毎朝7:40にheadlessで各ポータルへログインを試みる(daily-syncの8:23より前に温めておく)。
# 7:40にPCが起きていなければ、次に使える時点で実行する(StartWhenAvailable)。
# 前提: 事前に本人が store-credential.ps1 で credential-store\<portal>.json を作っていること。
#       レコードの無いポータルはランナー側で安全にskipされる。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-local-login' -Confirm:$false
param(
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$At = '07:40',
  [switch]$Disabled
)
$ErrorActionPreference = 'Stop'
$launcher = Join-Path $PSScriptRoot 'run-local-login.vbs'

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)

$trigger = New-ScheduledTaskTrigger -Daily -At $At

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
if ($Disabled) { $settings.Enabled = $false }

Register-ScheduledTask -TaskName 'katazuku-local-login' -TaskPath '\' `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku 毎日ログイン: 本人が設定したサービスへ専用Chromeでログイン(端末内設定: logs/local-login-settings.local.json)' `
  -Force | Out-Null

"タスク 'katazuku-local-login' を登録しました(毎日 $At、停止: $([bool]$Disabled))。"
"手動テスト(1ポータル): node `"$PSScriptRoot\local-login\daily-login.mjs`" --portal labbase --headful"
