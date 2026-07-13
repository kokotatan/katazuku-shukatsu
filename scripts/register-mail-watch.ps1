# katazuku mail-watch — 日中の自律メール対応をタスクスケジューラに登録する(1回実行すればよい)
# 毎日 07:15 から 22:15 まで1時間おきに mail-watch.ps1 をheadless実行する。
# (08:23のdaily-sync・09:00のasa・毎時00分のクラウド見張りと時間をずらしてある)
# 解除: Unregister-ScheduledTask -TaskName 'katazuku-mail-watch' -Confirm:$false
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\mail-watch.ps1`""

$trigger = New-ScheduledTaskTrigger -Daily -At '07:15'
$rep = (New-ScheduledTaskTrigger -Once -At '07:15' `
  -RepetitionInterval (New-TimeSpan -Hours 1) `
  -RepetitionDuration (New-TimeSpan -Hours 15)).Repetition
$trigger.Repetition = $rep

# PCが07:15に寝ていた日でも、その日最初のログオンで1回走らせる(2分遅延)
$logonTrigger = New-ScheduledTaskTrigger -AtLogOn
$logonTrigger.Delay = 'PT2M'

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 20)

Register-ScheduledTask -TaskName 'katazuku-mail-watch' `
  -Action $action -Trigger @($trigger, $logonTrigger) -Settings $settings `
  -Description 'katazuku 自律メール対応: 未読見張り→緊急は返信下書き+カレンダー登録+トースト通知(ログは logs/mail-watch-*.log)' `
  -Force | Out-Null

"タスク 'katazuku-mail-watch' を登録しました(毎日07:15〜22:15、1時間おき、headless実行)。"
"手動テスト: powershell -NoProfile -ExecutionPolicy Bypass -File `"$repo\scripts\mail-watch.ps1`""
