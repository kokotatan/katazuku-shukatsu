# record-audio: 面接・面談を「音声のみ」で録るレコーダー(ゲームバー非依存)。
#
# なぜこれを作ったか(2026-07-16):
#   ゲームバー(record-toggle/record-session)は「前面ウィンドウのアプリの音声」しか録らないため、
#   Zoomデスクトップアプリの面接で相手の声が1音も入らない事故が起きた。しかも議事録
#   パイプライン(interview-digest.ps1)は -vn で映像を捨てて音声しか使わないのに、3GB超のmp4を
#   吐いていた。ここではffmpegで「マイク(自分)」+「システム音声(相手の声)」を
#   直接録って1本のwavに混ぜる。ウィンドウのフォーカスに一切依存しない。ファイルも桁違いに小さい。
#
# システム音声(相手の声)の捕捉について(2026-07-23 調査確定):
#   このPCの Realtek「ステレオ ミキサー」はシステム音声を一切拾えない(確実なトーンを鳴らして
#   録っても mean/max -91dB=無音)。面談音声は USB/Bluetooth ヘッドホンに出るため、Realtek出力
#   しか映さないステレオミキサーには相手の声が乗らない。
#   ffmpeg 8.1.2 は「既定の再生デバイスのループバック」を第三者ソフト無しには録れない:
#     - 音声入力バックエンドは dshow と openal のみ。どちらも「録音(capture)デバイス」しか開けず、
#       再生(render)エンドポイントのループバックは開けない。
#     - `-f wasapi` は存在しない(ffmpeg に WASAPI loopback demuxer は無い)。
#   → 根本解決には仮想オーディオ・キャプチャ(VB-CABLE / screen-capture-recorder の
#     virtual-audio-capturer 等)の導入が必要。導入は本人の明示同意が要るので本スクリプトでは行わない。
#     導入後の1行変更手順は本ファイル末尾の TODO を参照。
#   現状は従来どおりステレオミキサーを探して録るが、無音のときは強く警告し、録音後に無音を検知したら
#     logs/alert-record.txt を残す(asa が【自動化の故障】として拾う)。
#
# 事前確認(推奨): -SoundCheck で「相手の声が本当に録れるか」を録画前に検査できる。
#   既定の再生デバイスへテストトーンを鳴らしつつシステム音声デバイスを数秒キャプチャし、
#   volumedetect で mean/max dB を測って OK/NG を表示する。max < -45dB を NG の目安とする。
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\record-audio.ps1 `
#       -StartTime "2026-07-17 11:00" -EndTime "2026-07-17 12:00" -Title "グッドパッチ"
#   -SoundCheck    : 録音はせず、相手の声(システム音声)が録れるかだけを検査して終わる
#   -SoundCheckSec : SoundCheck のキャプチャ秒数(既定5)
#   -DryRun        : デバイス検出と組み立てだけ行い、録音・議事録はしない(検証用)
#   -NoDigest      : 録音はするが interview-digest.ps1 に渡さない
#   -DurationSec   : Start/End の代わりに秒数で長さ指定(即時録画に便利)

param(
  [string]$StartTime,
  [string]$EndTime,
  [int]$DurationSec = 0,
  [string]$Title = '面接',
  [string]$Url = '',
  [int]$AppointmentId = 0,
  [switch]$SoundCheck,
  [int]$SoundCheckSec = 5,
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
$alertFile = Join-Path $logDir 'alert-record.txt'
$captures = Join-Path $env:USERPROFILE 'Videos\Captures'
if (-not (Test-Path $captures)) { New-Item -ItemType Directory $captures | Out-Null }
$digest = Join-Path $PSScriptRoot 'interview-digest.ps1'

# システム音声が無音だと判定するしきい値(max_volume がこれ未満なら「相手の声が録れていない」)
$SILENCE_MAX_DB = -45.0

function Log($m) { ("{0} [audio] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Tee-Object -FilePath $log -Append }

# 無音などの故障を alert-record.txt に残す(既存 alert-*.txt と同じ書式。asa が翌回に報告する)
function Write-RecordAlert($reason) {
  ("{0} record-audio 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $reason, (Split-Path $log -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
}

# ffmpeg を探す(PATH 未反映でも WinGet Links / Packages を辿る。interview-digest.ps1 と同じ方式)
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $cand = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe") +
          (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $ffmpeg = $cand | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ffmpeg) { Log 'ffmpeg が無い。winget install Gyan.FFmpeg'; exit 1 }

# wav を volumedetect にかけて mean/max dB を返す(取れなければ $null)
function Measure-Volume($file) {
  $out = & $ffmpeg -hide_banner -i $file -af volumedetect -f null - 2>&1
  $mean = $null; $max = $null
  foreach ($line in $out) {
    if ($line -match 'mean_volume:\s*(-?\d+(?:\.\d+)?) dB') { $mean = [double]$Matches[1] }
    elseif ($line -match 'max_volume:\s*(-?\d+(?:\.\d+)?) dB') { $max = [double]$Matches[1] }
  }
  if ($null -eq $mean -and $null -eq $max) { return $null }
  [pscustomobject]@{ Mean = $mean; Max = $max }
}

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

# システム音声(相手の声)。virtual-audio-capturer を最優先にする。
# 理由(2026-07-24実測): Realtek「ステレオ ミキサー」は Realtek 出力しか映さないため、
# 面談音声が USB/Bluetooth ヘッドホンに出るこのPCでは常に無音(-91dB)だった。
# virtual-audio-capturer は既定の再生デバイスをそのままループバックで拾うので、
# 出力先が何であっても相手の声が録れる。ステレオミキサーは後方互換のフォールバック。
$sys = $devs | Where-Object { $_.Name -match 'virtual-audio-capturer' } | Select-Object -First 1
if (-not $sys) {
  $sys = $devs | Where-Object { $_.Name -match 'ステレオ ?ミキサー|Stereo Mix' } | Select-Object -First 1
}

if (-not $mic) { Log '!! マイクが見つからない。録音できない'; exit 1 }
Log ("マイク = {0}" -f $mic.Name)
if ($sys) {
  Log ("システム音声 = {0}(相手の声も録れる想定)" -f $sys.Name)
} else {
  Log '!! ステレオミキサーが無効/不在。このままだと【相手の声は録れず、マイク(自分)だけ】になる。'
  Log '   → mmsys.cpl の「録音」タブで「ステレオ ミキサー」を有効化するか、下記TODOの仮想オーディオ導入を検討。'
}

# --- -SoundCheck: 録音前に「相手の声が録れるか」を検査する --------------------------------------
# 既定の再生デバイスへテストトーンを鳴らしつつ、システム音声デバイスを数秒キャプチャして
# volumedetect で max dB を測る。max >= しきい値なら OK(相手の声が乗る)。
if ($SoundCheck) {
  if (-not $sys) {
    Log '!! SoundCheck: システム音声デバイス(ステレオ ミキサー)が無い。相手の声を録る手段が現状ない。'
    Log '   NG: このPCでは相手の声を録れない。本ファイル末尾TODOの仮想オーディオ導入が必要。'
    exit 1
  }
  $tmp = [System.IO.Path]::GetTempPath()
  $tone = Join-Path $tmp ('record-soundcheck-tone-{0}.wav' -f $PID)
  $cap  = Join-Path $tmp ('record-soundcheck-cap-{0}.wav'  -f $PID)
  $capSec = [math]::Max(3, $SoundCheckSec)
  Log ("SoundCheck: 既定の再生デバイスへ {0}Hz のトーンを鳴らしつつ '{1}' を {2}秒キャプチャする" -f 440, $sys.Name, $capSec)

  # トーン生成(キャプチャ秒数より少し長く)。ステレオ44.1kHzのPCM wav = SoundPlayer が確実に鳴らせる。
  & $ffmpeg -hide_banner -loglevel error -y -f lavfi -i ("sine=frequency=440:duration={0}" -f ($capSec + 2)) -ac 2 -ar 44100 $tone 2>&1 | Out-Null
  if (-not (Test-Path $tone)) { Log '!! SoundCheck: テストトーンの生成に失敗した'; exit 1 }

  $player = $null
  try {
    # SoundPlayer は「既定の再生デバイス」へ流す(=面談音声と同じ出口。USB/BTが既定ならそこへ出る)。
    $player = New-Object System.Media.SoundPlayer $tone
    $player.PlayLooping()
    Start-Sleep -Milliseconds 400   # 再生が始まるのを待ってからキャプチャ
    & $ffmpeg -hide_banner -loglevel error -y -f dshow -i ("audio=" + $sys.Alt) -t $capSec $cap 2>&1 | Out-Null
  } finally {
    if ($player) { $player.Stop(); $player.Dispose() }
  }

  $exitCode = 0
  if (-not (Test-Path $cap)) {
    Log '!! SoundCheck: システム音声のキャプチャに失敗した(デバイスを開けない)'
    $exitCode = 1
  } else {
    $vol = Measure-Volume $cap
    if (-not $vol) {
      Log '!! SoundCheck: 音量測定に失敗した'
      $exitCode = 1
    } else {
      Log ("SoundCheck 結果: mean={0}dB / max={1}dB (NG目安 max<{2}dB)" -f $vol.Mean, $vol.Max, $SILENCE_MAX_DB)
      if ($vol.Max -ge $SILENCE_MAX_DB) {
        Log '   OK: システム音声(相手の声)が乗っている。この構成で録音してよい。'
      } else {
        Log '   NG: システム音声が無音。今の構成では相手の声が録れない。'
        Log '       原因: このPCのステレオミキサーは Realtek 出力しか映さず、面談音声は USB/BT に出るため。'
        Log '       対策: 面談音声の出力先を Realtek(既定スピーカー)にするか、TODO の仮想オーディオを導入する。'
        $exitCode = 1
      }
    }
  }
  Remove-Item $tone, $cap -Force -ErrorAction SilentlyContinue
  exit $exitCode
}

# --- 録音の長さを決める -----------------------------------------------------------------------------
$start = $null; try { if ($StartTime) { $start = [datetime]::Parse($StartTime) } } catch {}
$end = $null;   try { if ($EndTime)   { $end   = [datetime]::Parse($EndTime) } } catch {}
if ($DurationSec -gt 0) {
  # 秒数指定(即時/検証用)は正確にその長さだけ録る。前後の余白は付けない。
  if (-not $start) { $start = Get-Date }
  $recStart = $start
  $durSec = $DurationSec
  $end = $start.AddSeconds($DurationSec)   # ログ表示用(秒数指定でも終了時刻を持たせる)
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
# システム音声だけを別トラックにも書き出し、録音後の無音チェックに使う(検査後に削除する一時ファイル)
$sysCheckWav = Join-Path ([System.IO.Path]::GetTempPath()) ('record-syscheck-{0}.wav' -f $PID)

# --- ffmpeg 引数を組み立てる ------------------------------------------------------------------------
# マイク+システム音声を amix で1本に混ぜる。normalize=0 でマイク側が半分に減衰するのを防ぐ。
# 16kHz mono = Whisper に最適・ファイル最小。
# システム音声があるときは、混合トラック(議事録用)とシステム音声単独トラック(無音チェック用)を
# 同一 ffmpeg で2本同時に書き出す。混合後だとマイク音で埋もれて相手側の無音を判定できないため。
if ($sys) {
  $args = @('-hide_banner', '-loglevel', 'warning', '-y',
            '-f', 'dshow', '-i', ("audio=" + $mic.Alt),
            '-f', 'dshow', '-i', ("audio=" + $sys.Alt),
            '-filter_complex', '[0:a][1:a]amix=inputs=2:duration=longest:normalize=0[mix]',
            '-map', '[mix]', '-ac', '1', '-ar', '16000', '-t', "$durSec", $outWav,
            '-map', '1:a', '-ac', '1', '-ar', '16000', '-t', "$durSec", $sysCheckWav)
} else {
  $args = @('-hide_banner', '-loglevel', 'warning', '-y',
            '-f', 'dshow', '-i', ("audio=" + $mic.Alt),
            '-ac', '1', '-ar', '16000', '-t', "$durSec", $outWav)
}

Log ("録音予定: '{0}' [{1}-{2}] 実録{3}秒 -> {4}" -f $Title, $start.ToString('HH:mm'), $end.ToString('HH:mm'), $durSec, $outWav)

if ($DryRun) {
  Log ("DRYRUN: ffmpeg {0}" -f ($args -join ' '))
  return
}

try { & (Join-Path $PSScriptRoot 'start-recording-status.ps1') }
catch { Log ('録音状態の表示を起動できません: ' + $_.Exception.Message) }

# 開始時刻まで待つ(最大60秒スリープの分割待ち)
while ($true) {
  $rem = ($recStart - (Get-Date)).TotalSeconds
  if ($rem -le 0) { break }
  Start-Sleep -Seconds ([int][math]::Min(60, [math]::Ceiling($rem)))
}

Log '録音開始'
& $ffmpeg @args 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
if (-not (Test-Path $outWav)) { Log '!! 録音ファイルが生成されなかった'; Write-RecordAlert '録音ファイルが生成されなかった'; exit 1 }
$sizeMB = [math]::Round((Get-Item $outWav).Length / 1MB, 1)
Log ("録音完了: {0} ({1} MB)" -f $outWav, $sizeMB)

# --- 録音後のサイレンスガード: 相手の声が録れていなければ alert を残す ------------------------------
if ($sys -and (Test-Path $sysCheckWav)) {
  $vol = Measure-Volume $sysCheckWav
  if ($vol) {
    Log ("システム音声チェック: mean={0}dB / max={1}dB (NG目安 max<{2}dB)" -f $vol.Mean, $vol.Max, $SILENCE_MAX_DB)
    if ($vol.Max -lt $SILENCE_MAX_DB) {
      Log '!! システム音声が無音。相手の声が録れていない可能性が高い。alert-record.txt を残す。'
      Write-RecordAlert ("システム音声が無音(max_volume {0}dB < {1}dB)。相手の声が録れていない可能性。SoundCheck で構成を確認せよ" -f $vol.Max, $SILENCE_MAX_DB)
    } elseif (Test-Path $alertFile) {
      Remove-Item $alertFile -Force   # 前回の無音アラートを正常復帰で消す
    }
  }
  Remove-Item $sysCheckWav -Force -ErrorAction SilentlyContinue
} elseif (-not $sys) {
  Log '!! システム音声デバイスが無く、相手の声を録れていない。alert-record.txt を残す。'
  Write-RecordAlert 'システム音声デバイス(ステレオ ミキサー)が不在。相手の声が録れていない。SoundCheck / 仮想オーディオ導入を検討'
}

if ($NoDigest) { return }

# 議事録パイプラインへ(バックグラウンドで起動して即抜ける)
Log '議事録生成をキック'
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $digest),
  '-InputPath', ('"{0}"' -f $outWav),
  '-AppointmentId', $AppointmentId)

# ======================================================================================================
# TODO(相手の声を確実に録る根本対策 / 第三者バイナリの導入が必要 = 本人の明示同意が要る):
#   このPCのステレオミキサーは無音、ffmpeg も第三者ソフト無しには既定出力のループバックを録れない。
#   面談音声が USB/Bluetooth ヘッドホンに出るケースを含めて確実に録るには、仮想オーディオの導入が要る。
#
#   推奨A(dshow でそのまま使える): screen-capture-recorder / rdp-virtual-audio 等が入れる
#     「virtual-audio-capturer」DirectShow ソース。導入すると本スクリプトの Get-DshowAudioDevices に
#     "virtual-audio-capturer"(audio)が現れる。導入後の変更は1行だけ:
#       $sys を選ぶ行(現在は 'ステレオ ?ミキサー|Stereo Mix' で検索)を
#         $sys = $devs | Where-Object { $_.Name -match 'virtual-audio-capturer|ステレオ ?ミキサー|Stereo Mix' } | Select-Object -First 1
#       に変える(virtual-audio-capturer を優先ヒットさせる)。これで既定出力のループバックを録れる。
#
#   推奨B(仮想ケーブル): VB-CABLE を導入し、Windows の既定の再生デバイスを "CABLE Input" にして、
#     さらに「聴く」で実機ヘッドホンにもモニタさせる運用。録音側は dshow の "CABLE Output" を
#     $sys にする(上と同様に Where-Object の正規表現へ 'CABLE Output' を足す1行変更)。
#     ただし既定出力を切り替える運用が要るため、導入の手間は推奨Aより大きい。
#
#   いずれも導入後は必ず -SoundCheck で OK 判定を確認してから本番録音すること。
# ======================================================================================================
