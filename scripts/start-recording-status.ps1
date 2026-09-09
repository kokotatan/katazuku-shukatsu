# コンソールを出さず、録音状態の小窓を一つだけ起動する。
param([ValidateSet('Show', 'Hide', 'Toggle')][string]$Action = 'Show')
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'lib-recording-status.ps1')
$existing = $null
try {
  $existing = [Threading.Mutex]::OpenExisting((Get-KatazukuRecordingWindowKey $repo))
  $signal = $null
  try {
    $signal = [Threading.EventWaitHandle]::OpenExisting(((Get-KatazukuRecordingWindowKey $repo) + '-' + $Action.ToLowerInvariant()))
    [void]$signal.Set()
  } catch [Threading.WaitHandleCannotBeOpenedException] { }
  finally { if ($signal) { $signal.Dispose() } }
  return
} catch [Threading.WaitHandleCannotBeOpenedException] {
  if ($Action -eq 'Hide') { return }
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', ('"{0}"' -f (Join-Path $PSScriptRoot 'recording-status.ps1')))
} finally { if ($existing) { $existing.Dispose() } }
