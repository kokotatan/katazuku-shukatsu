# capture-meeting-shots: オンライン面談中にプライマリ画面の全画面スクリーンショットを撮る。
# record-vac.ps1 が録音開始と同時に隠しプロセスとして起動する。
# 撮った png は、あとで面談相手の顔写真を切り出す元データになる。
#
# 方針(会議進行を絶対に妨げない):
#   - 撮影失敗・アセンブリ読込失敗はログに残して続行し、このプロセスの外へ例外を出さない
#   - 保存先は logs/interviews/<録音と同じスラッグ>-shots(gitignore 済みの logs/ 配下。個人情報)
#   - 外部ツールは使わない(System.Drawing の CopyFromScreen のみ)
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\capture-meeting-shots.ps1 `
#       -OutDir "logs\interviews\<スラッグ>-shots" [-DelaySec "180,600"] [-EndTime "2026-07-28 15:00"]
#   -DelaySec はカンマ区切りの秒数(既定 "180,600" = 開始約3分後と約10分後)。-File 経由だと
#   配列引数は文字列でしか渡らないため、文字列で受けて自前で分解する。"0" で即時1枚(検証用)。
#   -EndTime(会議の終了予定)を過ぎる撮影は行わない。会議が短ければ撮れた分だけでよい。
param(
  [Parameter(Mandatory = $true)][string]$OutDir,
  [string]$DelaySec = '180,600',
  [string]$EndTime = ''
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$log = Join-Path $logDir 'meeting-record.log'
function Log($m) { ("{0} [shots] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }

if (-not [System.IO.Path]::IsPathRooted($OutDir)) { $OutDir = Join-Path $repo $OutDir }

# カンマ区切りの秒数を整数配列へ。解釈できない要素は捨て、全滅なら既定値で続行する。
$delays = @()
foreach ($part in ($DelaySec -split ',')) {
  $sec = 0
  if ([int]::TryParse($part.Trim(), [ref]$sec)) { $delays += $sec }
}
if ($delays.Count -eq 0) {
  Log ("DelaySecが読めないため既定値(180,600)で続行: {0}" -f $DelaySec)
  $delays = @(180, 600)
}

$end = $null
if ($EndTime) {
  try { $end = [datetime]::Parse($EndTime) } catch { Log ("EndTimeが読めないため終了ガード無しで続行: {0}" -f $EndTime) }
}

# 高DPI環境でスケーリング後の仮想解像度しか写らず画面が欠けるのを防ぐ(失敗しても撮影は続行)
try {
  Add-Type -Namespace KatazukuShots -Name Native -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetProcessDPIAware();' -ErrorAction Stop
  [void][KatazukuShots.Native]::SetProcessDPIAware()
} catch { Log ("SetProcessDPIAware に失敗(縮小スクショで続行): {0}" -f $_.Exception.Message) }

try {
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
} catch {
  Log ("撮影用アセンブリの読込に失敗。今回のスクショは諦める(会議進行への影響なし): {0}" -f $_.Exception.Message)
  return
}

# プライマリ画面の全画面を png 1枚に保存する。成否を $true/$false で返し、例外は外へ出さない。
function Save-PrimaryScreenshot([string]$path) {
  $bmp = $null; $g = $null
  try {
    $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
    $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
    $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
    return (Test-Path $path)
  } catch {
    Log ("撮影に失敗(続行): {0}: {1}" -f $path, $_.Exception.Message)
    return $false
  } finally {
    if ($g) { $g.Dispose() }
    if ($bmp) { $bmp.Dispose() }
  }
}

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory $OutDir -Force | Out-Null }
$startedAt = Get-Date
$shot = 0
foreach ($delay in ($delays | Sort-Object)) {
  $shotAt = $startedAt.AddSeconds($delay)
  if ($end -and $shotAt -ge $end) {
    Log ("会議の終了予定({0:HH:mm})を過ぎるため開始{1}秒後の撮影は行わない" -f $end, $delay)
    continue
  }
  # 撮影時刻まで分割待ち(長時間Sleepはスリープ復帰でずれることがある)
  while ($true) {
    $rem = ($shotAt - (Get-Date)).TotalSeconds
    if ($rem -le 0) { break }
    Start-Sleep -Seconds ([int][math]::Min(60, [math]::Ceiling($rem)))
  }
  $shot += 1
  $path = Join-Path $OutDir ('shot-{0:d3}.png' -f $shot)
  if (Save-PrimaryScreenshot $path) {
    Log ("撮影した: {0}" -f $path)
  }
}
Log ("撮影終了: {0} ({1}枚)" -f $OutDir, (Get-ChildItem $OutDir -Filter 'shot-*.png' -ErrorAction SilentlyContinue | Measure-Object).Count)
