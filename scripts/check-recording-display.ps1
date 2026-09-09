# 表示部品の操作を画面外で検証する。実録音や他のアプリへキー入力を送らない。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'recording-status-window.cs') -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RecordingDisplayCheckInput {
    [DllImport("user32.dll")] private static extern IntPtr SendMessage(IntPtr window, int message, IntPtr wParam, IntPtr lParam);
    public static void Toggle(IntPtr window) { SendMessage(window, 0x0312, new IntPtr(0x4B52), new IntPtr((0x52 << 16) | 3)); }
}
'@
[Windows.Forms.Application]::EnableVisualStyles()
$script:checks = 0
function Check([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
  $script:checks++
  Write-Output ('OK: ' + $message)
}
$window = New-Object Katazuku.RecordingStatusWindow($false, $false)
try {
  $window.Location = New-Object Drawing.Point(-32000, -32000)
  $window.Show()
  Check ($window.Visible -and $window.CaptureExcluded) '手元には表示し、画面共有から除外する'
  [RecordingDisplayCheckInput]::Toggle($window.Handle)
  Check (-not $window.Visible) 'ショートカットのメッセージで非表示にできる'
  [RecordingDisplayCheckInput]::Toggle($window.Handle)
  Check ($window.Visible -and $window.CaptureExcluded) '同じショートカットで再表示できる'
  $window.Hide()
  $window.DisplayStatus('starting', '録音開始を確認中', '書き込みを確認しています', 0, [string[]]@('meeting-a'))
  Check $window.Visible '録音を開始すると非表示から自動表示へ戻る'
  $window.ToggleDisplay()
  $window.DisplayStatus('recording', '録音中', '音声ファイルを保存しています', 2, [string[]]@('meeting-a'))
  Check (-not $window.Visible) '本人が隠した表示を同じ録音の更新で戻さない'
  $window.DisplayStatus('unknown', '状態を確認できません', '再試行中です', 0, [string[]]@())
  $window.DisplayStatus('recording', '録音中', '音声ファイルを保存しています', 10, [string[]]@('meeting-a'))
  Check (-not $window.Visible) '状態取得の一時失敗から復帰しても非表示を維持する'
  $window.DisplayStatus('stopped', '録音停止中', '録音していません', 0, [string[]]@())
  $window.DisplayStatus('starting', '録音開始を確認中', '書き込みを確認しています', 0, [string[]]@('meeting-a'))
  Check (-not $window.Visible) '録り直しの短い中断でも非表示を維持する'
  $window.DisplayStatus('starting', '録音開始を確認中', '書き込みを確認しています', 0, [string[]]@('meeting-b'))
  Check $window.Visible '次の録音はデフォルトで表示する'
  $window.Hide()
  $window.DisplayStatus('recording', '録音中', '音声ファイルを保存しています', 5, [string[]]@('meeting-b', 'meeting-c'))
  Check $window.Visible '録音中に別の録音が追加された場合も表示する'
  $window.ShowInTaskbar = $true
  $window.ShowInTaskbar = $false
  [RecordingDisplayCheckInput]::Toggle($window.Handle)
  Check (-not $window.Visible) 'ウィンドウ再生成後もショートカットで切り替えられる'
  [RecordingDisplayCheckInput]::Toggle($window.Handle)
  Check ($window.Visible -and $window.CaptureExcluded) '再生成後の再表示でも共有除外を維持する'
} finally { $window.Dispose() }
Write-Output ('録音表示の操作: {0}項目の検証に成功' -f $script:checks)
