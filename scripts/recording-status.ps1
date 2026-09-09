# 録音状態を画面の端に常駐表示する。録音開始・停止の操作は行わない。
param([switch]$Once)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
. (Join-Path $PSScriptRoot 'lib-recording-status.ps1')
if ($Once) {
  $history = @{}
  $null = Get-KatazukuRecordingStatus -RepositoryRoot $repo -History $history
  Start-Sleep -Seconds 2
  Get-KatazukuRecordingStatus -RepositoryRoot $repo -History $history | ConvertTo-Json -Compress
  return
}

$mutex = New-Object Threading.Mutex($false, (Get-KatazukuRecordingWindowKey $repo))
$ownsMutex = $false
$worker = $null; $window = $null; $timer = $null
$showSignal = $null
$hideSignal = $null; $toggleSignal = $null
try {
  try { $ownsMutex = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex) { return }
  $showSignal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, ((Get-KatazukuRecordingWindowKey $repo) + '-show'))
  $hideSignal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, ((Get-KatazukuRecordingWindowKey $repo) + '-hide'))
  $toggleSignal = New-Object Threading.EventWaitHandle($false, [Threading.EventResetMode]::AutoReset, ((Get-KatazukuRecordingWindowKey $repo) + '-toggle'))
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  Add-Type -Path (Join-Path $PSScriptRoot 'recording-status-window.cs') -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core
  [Windows.Forms.Application]::EnableVisualStyles()
  $window = New-Object Katazuku.RecordingStatusWindow
  # 前回ドラッグした位置を復元する。画面構成が変わって範囲外なら右下へ戻す。
  $diagnosticPath = Join-Path $repo 'logs\recording-display.local.json'
  try {
    if (Test-Path -LiteralPath $diagnosticPath) {
      $lastPosition = Get-Content -LiteralPath $diagnosticPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $point = New-Object Drawing.Point([int]$lastPosition.left, [int]$lastPosition.top)
      $bounds = New-Object Drawing.Rectangle($point, $window.Size)
      if (@([Windows.Forms.Screen]::AllScreens | Where-Object { $_.WorkingArea.Contains($bounds) }).Count -gt 0) { $window.Location = $point }
    }
  } catch { }
  # CIMの取得が遅くても画面を固めない。監視の停止は10秒の鮮度検査で表示する。
  $shared = [hashtable]::Synchronized(@{ Stop = $false; Status = $null })
  $worker = [PowerShell]::Create()
  [void]$worker.AddScript({
    param($root, $sharedState)
    . (Join-Path $root 'scripts\lib-recording-status.ps1')
    $history = @{}
    while (-not $sharedState.Stop) {
      $sharedState.Status = Get-KatazukuRecordingStatus -RepositoryRoot $root -History $history
      Start-Sleep -Seconds 2
    }
  }).AddArgument($repo).AddArgument($shared)
  $pending = $worker.BeginInvoke()
  $timer = New-Object Windows.Forms.Timer
  $timer.Interval = 1000
  $timer.Add_Tick({
    $status = $shared.Status
    if ($null -eq $status -or ([datetime]::UtcNow - [datetime]::Parse($status.UpdatedAt).ToUniversalTime()).TotalSeconds -gt 10) {
      $window.DisplayStatus('unknown', '録音状態を確認できません', '状態の更新を待っています', 0)
    } else {
      $seconds = $status.ElapsedSeconds + [int]([datetime]::UtcNow - [datetime]::Parse($status.UpdatedAt).ToUniversalTime()).TotalSeconds
      $window.DisplayStatus($status.State, $status.Label, $status.Detail, $seconds, [string[]]$status.SessionIds)
    }
    # 同じ巡回に本人操作が届いた場合は、自動表示より本人の指定を優先する。
    if ($showSignal.WaitOne(0)) { $window.Show() }
    if ($hideSignal.WaitOne(0)) { $window.Hide() }
    if ($toggleSignal.WaitOne(0)) { $window.ToggleDisplay() }
    # 運用確認用。音声・ファイル名・会議名は表示の診断情報へ書き出さない。
    try {
      $diagnostic = @{ status = $status; visible = $window.Visible; left = $window.Left; top = $window.Top;
        width = $window.Width; height = $window.Height; topMost = $window.TopMost;
        captureExcluded = $window.CaptureExcluded; showInTaskbar = $window.ShowInTaskbar;
        hotKeyRegistered = $window.HotKeyRegistered; hotKey = $window.HotKeyText; hotKeyError = $window.HotKeyError;
        updatedAt = [datetime]::UtcNow.ToString('o') }
      [IO.File]::WriteAllText((Join-Path $repo 'logs\recording-display.local.json'), ($diagnostic | ConvertTo-Json -Depth 4), (New-Object Text.UTF8Encoding($false)))
    } catch { }
  })
  $timer.Start()
  [Windows.Forms.Application]::Run($window)
} catch {
  try { Add-Content -LiteralPath (Join-Path $repo 'logs\recording-display-error.log') -Value ((Get-Date).ToString('o') + ' ' + $_.Exception.Message) -Encoding utf8 } catch { }
  throw
} finally {
  if ($shared) { $shared.Stop = $true }
  if ($timer) { $timer.Stop(); $timer.Dispose() }
  if ($worker) { $worker.Stop(); $worker.Dispose() }
  if ($window) { $window.Dispose() }
  if ($showSignal) { $showSignal.Dispose() }
  if ($hideSignal) { $hideSignal.Dispose() }
  if ($toggleSignal) { $toggleSignal.Dispose() }
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  $mutex.Dispose()
}
