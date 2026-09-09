# 表示部品の描画確認。実際のマイク・録音・既存ウィンドウには接触しない。
param([string]$OutputDirectory = '')
$ErrorActionPreference = 'Stop'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) 'logs\recording-display-preview' }
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Path (Join-Path $PSScriptRoot 'recording-status-window.cs') -ReferencedAssemblies System.Windows.Forms, System.Drawing, System.Core
[Windows.Forms.Application]::EnableVisualStyles()
$previews = @(
  @('stopped', '録音停止中', '現在、録音していません', 0),
  @('recording', '録音中', '音声ファイルを保存しています', 187),
  @('stalled', '録音を確認', '音声の保存が15秒以上止まっています', 0),
  @('unknown', '録音状態を確認できません', '状態の更新を待っています', 0)
)
foreach ($preview in $previews) {
  $form = New-Object Katazuku.RecordingStatusWindow($false)
  $bitmap = New-Object Drawing.Bitmap($form.Width, $form.Height)
  try {
    # Labelは親が不可視だとDrawToBitmapに描かれない。検証用フォームだけ画面外で描画する。
    $form.ShowInTaskbar = $false
    $form.Location = New-Object Drawing.Point(-32000, -32000)
    $form.Show()
    if (-not $form.CaptureExcluded -or -not $form.Visible) { throw '手元への表示と画面共有からの除外を両立できません' }
    # 再生成されるウィンドウにも除外設定が引き継がれることを確認する。
    $form.ShowInTaskbar = $true
    $form.ShowInTaskbar = $false
    if (-not $form.CaptureExcluded) { throw 'ウィンドウ再生成後の画面共有除外が無効です' }
    $form.DisplayStatus($preview[0], $preview[1], $preview[2], $preview[3])
    $form.Refresh()
    $form.DrawToBitmap($bitmap, (New-Object Drawing.Rectangle(0, 0, $form.Width, $form.Height)))
    $path = Join-Path $OutputDirectory ($preview[0] + '.png')
    $bitmap.Save($path, [Drawing.Imaging.ImageFormat]::Png)
    Write-Output $path
  } finally { $bitmap.Dispose(); $form.Dispose() }
}
