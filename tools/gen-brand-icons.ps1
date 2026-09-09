# 承認済みネクタイのマスター画像から、配信用サイズを書き出す。
# 画像の意匠は変更せず、縮小のみを行う。
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$brandRoot = Split-Path -Parent $PSScriptRoot
$brandSource = Join-Path $PSScriptRoot 'brand/necktie-master.png'
$brandOutput = Join-Path $brandRoot 'landing/icons'
$brandImage = [System.Drawing.Image]::FromFile($brandSource)
try {
  foreach ($entry in @(
    @{ Size = 16; Name = 'favicon-16.png' },
    @{ Size = 32; Name = 'favicon-32.png' },
    @{ Size = 180; Name = 'necktie-apple-touch.png' },
    @{ Size = 192; Name = 'necktie-192.png' },
    @{ Size = 512; Name = 'necktie-512.png' }
  )) {
    $brandBitmap = New-Object System.Drawing.Bitmap($entry.Size, $entry.Size)
    $brandGraphics = [System.Drawing.Graphics]::FromImage($brandBitmap)
    try {
      $brandGraphics.Clear([System.Drawing.Color]::White)
      $brandGraphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $brandGraphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $brandGraphics.DrawImage($brandImage, 0, 0, $entry.Size, $entry.Size)
      $brandBitmap.Save((Join-Path $brandOutput $entry.Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $brandGraphics.Dispose()
      $brandBitmap.Dispose()
    }
    Write-Host "生成: $($entry.Name) ($($entry.Size)px)"
  }
} finally {
  $brandImage.Dispose()
}
