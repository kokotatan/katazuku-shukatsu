param(
  [ValidateSet('Read', 'Apply')][string]$Operation = 'Read',
  [ValidatePattern('^([01]\d|2[0-3]):[0-5]\d$')][string]$At = '07:40',
  [switch]$Disabled
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$taskName = 'katazuku-local-login'
# 未登録と照会失敗を区別する。権限エラーを「停止中」と解釈しない。
$task = Get-ScheduledTask -TaskPath '\' -ErrorAction Stop | Where-Object { $_.TaskName -eq $taskName }
if ($Operation -eq 'Apply') {
  $previousXml = if ($task) { Export-ScheduledTask -TaskName $taskName -TaskPath '\' } else { $null }
  try {
    & (Join-Path (Split-Path $PSScriptRoot -Parent) 'register-local-login.ps1') -At $At -Disabled:$Disabled | Out-Null
    $task = Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction Stop
    if ([bool]$task.Settings.Enabled -eq [bool]$Disabled) { throw 'タスク状態が保存内容と一致しません。' }
  }
  catch {
    if ($previousXml) { Register-ScheduledTask -TaskName $taskName -TaskPath '\' -Xml $previousXml -Force | Out-Null }
    elseif (Get-ScheduledTask -TaskName $taskName -TaskPath '\' -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $taskName -TaskPath '\' -Confirm:$false
    }
    throw '実行予約を更新できませんでした。'
  }
}
$time = $null
if ($task -and $task.Triggers.Count -eq 1 -and $task.Triggers[0].StartBoundary -match 'T(\d{2}:\d{2})') { $time = $Matches[1] }
[pscustomobject]@{
  registered = [bool]$task
  enabled = [bool]($task -and $task.Settings.Enabled)
  time = $time
  state = if ($task) { [string]$task.State } else { 'NotRegistered' }
} | ConvertTo-Json -Compress
