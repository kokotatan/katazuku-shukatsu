# record-audio: 面接・面談を「音声のみ」で録るレコーダー(ゲームバー非依存)。
#
# なぜこれを作ったか(2026-07-16):
#   ゲームバー(record-toggle/record-session)は「前面ウィンドウのアプリの音声」しか録らないため、
#   Zoomデスクトップアプリの面接で相手の声が1音も入らない事故が起きた。しかも議事録
#   パイプライン(interview-digest.ps1)は -vn で映像を捨てて音声しか使わないのに、3GB超のmp4を
#   吐いていた。ここではffmpegで「マイク(自分)」+「ステレオミキサー(システム音声=相手の声)」を
#   直接録って1本のwavに混ぜる。ウィンドウのフォーカスに一切依存しない。ファイルも桁違いに小さい。
#
# 前提(1回だけの手動設定):Windowsの「ステレオ ミキサー」を有効化しておくこと。
#   サウンド設定 → 録音デバイス(mmsys.cpl の「録音」タブ)→ 空白を右クリック →「無効なデバイスの表示」
#   →「ステレオ ミキサー」を右クリック →「有効」。これが無効だと相手の声は録れない(マイクのみになる)。
#   ※本スクリプトは起動時にステレオミキサーの有無を検査し、無ければ警告してマイクのみで録る。
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\record-audio.ps1 `
#       -StartTime "2026-07-17 11:00" -EndTime "2026-07-17 12:00" -Title "グッドパッチ"
#   -DryRun     : デバイス検出と組み立てだけ行い、録音・議事録はしない(検証用)
#   -NoDigest   : 録音はするが interview-digest.ps1 に渡さない
#   -DurationSec: Start/End の代わりに秒数で長さ指定(即時録画に便利)

param(
  [string]$StartTime,
  [string]$EndTime,
  [int]$DurationSec = 0,
  [string]$Title = '面接',
  [string]$Url = '',
  [int]$AppointmentId = 0,
  [switch]$DryRun,
  [switch]$NoDigest
)

# PowerShell 5.1 は native exe(ffmpeg)の stderr 行を NativeCommandError として包み、EAP='Stop' だと
# それだけで致命になる。ffmpeg はデバイス一覧も進捗も stderr に出すため 'Stop' は使えない。
# 成否は各所の Test-Path / exit 1 で明示的に判定する。
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$log = Join-Path $logDir 'meeting-record.log'
$captures = Join-Path $env:USERPROFILE 'Videos\Captures'
if (-not (Test-Path $captures)) { New-Item -ItemType Directory $captures | Out-Null }
$digest = Join-Path $PSScriptRoot 'interview-digest.ps1'

function Log($m) { ("{0} [audio] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Tee-Object -FilePath $log -Append }

# ffmpeg を探す(PATH 未反映でも WinGet Links / Packages を辿る。interview-digest.ps1 と同じ方式)
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $cand = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe") +
          (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $ffmpeg = $cand | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ffmpeg) { Log 'ffmpeg が無い。winget install Gyan.FFmpeg'; exit 1 }

# --- dshow の音声デバイスを列挙し、フレンドリー名→内部名(ASCII)の対応を作る --------------------
# ffmpeg のコマンドラインに日本語デバイス名を渡すと文字化けで開けないことがあるため、
# 常に "Alternative name"(@device_cm_... のASCII)を使う。
function Get-DshowAudioDevices {
  $out = & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
  $devs = @(); $cur = $null
  foreach ($line in $out) {
    if ($line -match '"([^"]+)"\s+\(audio\)') {
      if ($cur) { $devs += $cur }
      $cur = [pscustomobject]@{ Name = $Matches[1]; Alt = $null }
    } elseif ($line -match '"([^"]+)"\s+\(video\)') {
      if ($cur) { $devs += $cur }; $cur = $null    # video デバイスは無視
    } elseif ($line -match 'Alternative name\s+"([^"]+)"' -and $cur) {
      $cur.Alt = $Matches[1]
    }
  }
  if ($cur) { $devs += $cur }
  $devs
}

$devs = Get-DshowAudioDevices
Log ("検出した音声デバイス: {0}" -f (($devs | ForEach-Object { $_.Name }) -join ' / '))

# マイク(自分の声)= 「マイク配列」優先、無ければ最初の音声デバイス
$mic = $devs | Where-Object { $_.Name -match 'マイク配列|Microphone Array' } | Select-Object -First 1
if (-not $mic) { $mic = $devs | Where-Object { $_.Name -match 'マイク|Microphone|Mic' } | Select-Object -First 1 }
if (-not $mic) { $mic = $devs | Select-Object -First 1 }

# システム音声(相手の声)= 「ステレオ ミキサー」
$sys = $devs | Where-Object { $_.Name -match 'ステレオ ?ミキサー|Stereo Mix' } | Select-Object -First 1

if (-not $mic) { Log '!! マイクが見つからない。録音できない'; exit 1 }
Log ("マイク = {0}" -f $mic.Name)
if ($sys) {
  Log ("システム音声 = {0}(相手の声も録れる)" -f $sys.Name)
} else {
  Log '!! ステレオミキサーが無効/不在。このままだと【相手の声は録れず、マイク(自分)だけ】になる。'
  Log '   → mmsys.cpl の「録音」タブで「ステレオ ミキサー」を有効化してから録り直すこと。'
}

# --- 録音の長さを決める -----------------------------------------------------------------------------
$start = $null; try { if ($StartTime) { $start = [datetime]::Parse($StartTime) } } catch {}
$end = $null;   try { if ($EndTime)   { $end   = [datetime]::Parse($EndTime) } } catch {}
if ($DurationSec -gt 0) {
  # 秒数指定(即時/検証用)は正確にその長さだけ録る。前後の余白は付けない。
  if (-not $start) { $start = Get-Date }
  $recStart = $start
  $durSec = $DurationSec
} else {
  if (-not $start) { $start = Get-Date }
  if (-not $end -or $end -le $start) { $end = $start.AddMinutes(60) }
  # 予定時刻ベースのときだけ、途中入室・延長に備え開始10秒前〜終了3分後の余白を付ける。
  $recStart = $start.AddSeconds(-10)
  $durSec = [int]([math]::Ceiling(($end.AddMinutes(3) - $recStart).TotalSeconds))
}

$stamp = $start.ToString('yyyy-MM-dd_HHmm')
$safeTitle = ($Title -replace '[\\/:*?"<>|]', '_')
$outWav = Join-Path $captures ("{0}-{1}.wav" -f $safeTitle, $stamp)

# --- ffmpeg 引数を組み立てる ------------------------------------------------------------------------
# マイク+システム音声を amix で1本に混ぜる。normalize=0 でマイク側が半分に減衰するのを防ぐ。
# 16kHz mono = Whisper に最適・ファイル最小。
$args = @('-hide_banner', '-loglevel', 'warning', '-y', '-f', 'dshow', '-i', ("audio=" + $mic.Alt))
if ($sys) {
  $args += @('-f', 'dshow', '-i', ("audio=" + $sys.Alt),
             '-filter_complex', 'amix=inputs=2:duration=longest:normalize=0',
             '-ac', '1', '-ar', '16000')
} else {
  $args += @('-ac', '1', '-ar', '16000')
}
$args += @('-t', "$durSec", $outWav)

Log ("録音予定: '{0}' [{1}-{2}] 実録{3}秒 -> {4}" -f $Title, $start.ToString('HH:mm'), $end.ToString('HH:mm'), $durSec, $outWav)

if ($DryRun) {
  Log ("DRYRUN: ffmpeg {0}" -f ($args -join ' '))
  return
}

# 開始時刻まで待つ(最大60秒スリープの分割待ち)
while ($true) {
  $rem = ($recStart - (Get-Date)).TotalSeconds
  if ($rem -le 0) { break }
  Start-Sleep -Seconds ([int][math]::Min(60, [math]::Ceiling($rem)))
}

Log '録音開始'
& $ffmpeg @args 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
if (-not (Test-Path $outWav)) { Log '!! 録音ファイルが生成されなかった'; exit 1 }
$sizeMB = [math]::Round((Get-Item $outWav).Length / 1MB, 1)
Log ("録音完了: {0} ({1} MB)" -f $outWav, $sizeMB)

if ($NoDigest) { return }

# 議事録パイプラインへ(バックグラウンドで起動して即抜ける)
Log '議事録生成をキック'
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $digest),
  '-InputPath', ('"{0}"' -f $outWav),
  '-AppointmentId', $AppointmentId)
