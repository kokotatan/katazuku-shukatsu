# katazuku self-update — MiniPCがGitHub上のmainへ安全に追従するタスクを登録する。
# 毎日03:54に実行し、更新がある場合だけ依存確認と全チェックを行う。
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-self-update' -Confirm:$false
$ErrorActionPreference = 'Stop'
$taskName = 'katazuku-self-update'
$launcher = Join-Path $PSScriptRoot 'run-self-update.vbs'

if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) {
  throw "self-updateランチャが見つかりません: $launcher"
}

$action = New-ScheduledTaskAction -Execute 'wscript.exe' `
  -Argument ('"{0}"' -f $launcher)
$trigger = New-ScheduledTaskTrigger -Daily -At '03:54'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 45)

Register-ScheduledTask -TaskName $taskName `
  -Action $action -Trigger $trigger -Settings $settings `
  -Description 'katazuku MiniPC更新: origin/mainをfast-forwardで取得し、全チェック成功時だけ最新版を維持する' `
  -Force | Out-Null

# 登録先がこのリポジトリを参照していることをOS側の実体から検算する。
$registered = Get-ScheduledTask -TaskName $taskName
$registeredLauncher = $registered.Actions[0].Arguments.Trim('"')
if ($registered.Actions[0].Execute -ne 'wscript.exe' -or
    -not [string]::Equals($registeredLauncher, $launcher, [StringComparison]::OrdinalIgnoreCase)) {
  throw "登録されたself-updateのActionが期待値と一致しません: $($registered.Actions[0].Execute) $($registered.Actions[0].Arguments)"
}
if (-not $registered.Settings.WakeToRun -or
    $registered.Settings.DisallowStartIfOnBatteries -or
    $registered.Settings.StopIfGoingOnBatteries) {
  throw 'self-updateの電源設定が期待値と一致しません'
}

"タスク '$taskName' を登録しました(毎日03:54、更新時だけ全チェック、ウィンドウ非表示)。"
"手動テスト: Start-ScheduledTask -TaskName '$taskName'"
