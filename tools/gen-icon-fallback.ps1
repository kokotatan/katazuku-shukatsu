# katazukuアプリアイコン(フォールバック): teal-500(#00C4CC)背景+白「片」のPNGを生成する
# 使い方: powershell -File tools/gen-icon-fallback.ps1
# 出力: landing/icons/icon-192.png / icon-512.png / apple-touch-icon.png(180, 不透明正方形)
# フォントはランディングと同じシステムフォント系(Yu Gothic UI Bold)
Add-Type -AssemblyName System.Drawing

$root = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $root 'landing\icons'
New-Item -ItemType Directory -Force $outDir | Out-Null

function New-KatazukuIcon([int]$size, [string]$path) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit

  # 背景: ブランドティール(全面。角丸はOS側のマスクに任せる)
  $teal = [System.Drawing.Color]::FromArgb(255, 0, 196, 204)
  $g.Clear($teal)

  # 「片」: 白・太字・中央。maskableのセーフゾーン(中央80%)に収まる大きさ
  $fontSize = [float]($size * 0.52)
  $font = New-Object System.Drawing.Font('Yu Gothic UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $white = [System.Drawing.Brushes]::White
  $fmt = New-Object System.Drawing.StringFormat
  $fmt.Alignment = [System.Drawing.StringAlignment]::Center
  $fmt.LineAlignment = [System.Drawing.StringAlignment]::Center
  $rect = New-Object System.Drawing.RectangleF(0, ($size * 0.01), $size, $size)
  $g.DrawString('片', $font, $white, $rect, $fmt)

  $g.Dispose()
  $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Host "OK $path"
}

New-KatazukuIcon 192 (Join-Path $outDir 'icon-192.png')
New-KatazukuIcon 512 (Join-Path $outDir 'icon-512.png')
New-KatazukuIcon 180 (Join-Path $outDir 'apple-touch-icon.png')
