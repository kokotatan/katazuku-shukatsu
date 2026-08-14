# record-vac: 面談を確実に録る(相手の声つき)。record-audio.ps1 の置き換え候補。
#
# なぜ別スクリプトか(2026-08-14): record-audio.ps1 は内蔵「マイク配列」だけを掴もうとして
# 0バイトで死ぬ事象が続き、Game Bar は「Meetに当てると分割/別ウィンドウに当てると相手の声が入らない」
# のどちらかにしかならず、Sansan 2次面接で相手の発言を丸ごと失いかけた。
# ここでは dshow の virtual-audio-capturer(既定の再生デバイスのループバック)と内蔵マイクを
# amix で1本にする。ヘッドセット/イヤホンでも相手の声が録れる。
#
# 録音長は「予定の終了時刻 + BufferMinutes - 現在時刻」で決める。固定の -t は使わない
# (同日の実害: 起点を録音開始に取った固定70分で、面接終了22分前に自動停止した)。
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\record-vac.ps1 -AppointmentId 89 -Slug Lightblue-setsumei
param(
  [Parameter(Mandatory = $true)][int]$AppointmentId,
  # 予定の終了時刻(ISO・空白なし。例 2026-08-14T19:30:00+09:00)。
  # DBから引く実装にしたらnode呼び出しが壊れたので、呼び手が渡す方式にした(2026-08-14)。
  # 予定は `cd sync; npx tsx scripts/db-quick.ts today` か db-inspect で確認できる。
  [Parameter(Mandatory = $true)][string]$EndIso,
  # 予定の開始時刻(ISO・空白なし)。渡すと開始 LeadMinutes 前まで待ってから録り始める。
  # 省略すると即座に録音を開始する(直前に手で起動する場合はそれでよい)。
  # 2026-08-14の実害: 18:00開始の説明会を17:16から録り始め、44分/85MBを無駄にした。
  [string]$StartIso = '',
  [int]$LeadMinutes = 5,
  [string]$Slug = '',
  [int]$BufferMinutes = 15
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$intDir = Join-Path $repo 'logs\interviews'
if (-not (Test-Path $intDir)) { New-Item -ItemType Directory $intDir -Force | Out-Null }
$log = Join-Path $repo 'logs\meeting-record.log'
# ログ書き込みは絶対に録音を巻き添えにしない。meeting-record.log は autopilot・shots・digest が
# 同時に開くため、EAP=Stop のまま Out-File すると「使用中」で録音起動ごと落ちる(2026-08-14に実際に発生)。
# 数回だけ譲って待ち、それでも書けなければ黙って捨てる。
function Log($m) {
  $line = "{0} [record-vac] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  for ($i = 0; $i -lt 5; $i++) {
    try { Add-Content -LiteralPath $log -Value $line -Encoding utf8 -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 200 }
  }
}

# ISO文字列をローカル時刻として正しく読む。
# 罠(2026-08-14に踏んだ): [datetime]::Parse("2026-08-14T19:27:45") は Kind=Unspecified になり、
# そこへ .ToLocalTime() を呼ぶと「UTCだった」とみなされて +9時間される。
# 結果、1分のはずの録音長が541分と算出された。オフセット付き("+09:00")のときだけ変換する。
function ConvertTo-LocalTime([string]$iso) {
  $parsed = [datetime]::Parse($iso, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
  if ($parsed.Kind -eq [DateTimeKind]::Utc) { return $parsed.ToLocalTime() }
  return $parsed  # Unspecified はそのままローカルとして扱う / Local は変換済み
}

# 二重録音ガード(2026-08-14の実害): 同じLightblue説明選考会を autopilot と手動起動で
# 2本録ってしまい、178MBと235MBの重複ができた。予定IDごとにロックを持ち、
# 記録されたPIDがまだ生きていれば後発は何もせず抜ける。
$lock = Join-Path $repo ("logs\record-vac-{0}.lock" -f $AppointmentId)
if (Test-Path $lock) {
  $oldPid = 0
  if ([int]::TryParse(((Get-Content -LiteralPath $lock -ErrorAction SilentlyContinue | Select-Object -First 1)), [ref]$oldPid)) {
    if (Get-Process -Id $oldPid -ErrorAction SilentlyContinue) {
      Log ("予定{0}は既に録音中(PID {1})。二重起動を回避して終了する" -f $AppointmentId, $oldPid)
      exit 0
    }
  }
}
Set-Content -LiteralPath $lock -Value $PID -Encoding ascii

$endAt = ConvertTo-LocalTime $EndIso

# 開始時刻が渡されていれば、開始 LeadMinutes 前まで待つ。無駄な前録りを避ける。
if ($StartIso) {
  $startAt = ConvertTo-LocalTime $StartIso
  $beginAt = $startAt.AddMinutes(-$LeadMinutes)
  $wait = [int]($beginAt - (Get-Date)).TotalSeconds
  if ($wait -gt 0) {
    Log ("開始{0}の{1}分前({2})まで待機する: {3}秒" -f $startAt.ToString('HH:mm'), $LeadMinutes, $beginAt.ToString('HH:mm'), $wait)
    # 一気にSleepせず分割する(record-audio.ps1 と同じ方式。長時間Sleepは復帰でずれることがある)
    while ($true) {
      $rem = ($beginAt - (Get-Date)).TotalSeconds
      if ($rem -le 0) { break }
      Start-Sleep -Seconds ([int][math]::Min(60, [math]::Ceiling($rem)))
    }
  }
}

$durSec = [int](($endAt.AddMinutes($BufferMinutes)) - (Get-Date)).TotalSeconds
if ($durSec -le 0) { Log '終了時刻を過ぎている'; exit 1 }

# 出力名は空白なしにする。PowerShell 5.1 の Start-Process -ArgumentList は空白で引数を割ってしまい、
# 実際に 2026-08-14 に出力パスとスクリプト引数の両方が壊れた。
if (-not $Slug) { $Slug = 'meeting-' + $AppointmentId }
# 日本語は残す。壊すのは「空白」と、ファイル名に使えない文字だけ。
# 空白を必ず落とすのは、呼び出し側の Start-Process -ArgumentList が空白で引数を割るため。
$Slug = ($Slug -replace '[\\/:*?"<>|\s]', '') -replace '-+', '-'
$stem = "{0}-{1}" -f $Slug, (Get-Date -Format 'yyyy-MM-dd_HHmm')
$outWav = Join-Path $intDir ($stem + '.wav')
$shotsDir = Join-Path $intDir ($stem + '-shots')

# dshow のデバイスは表示名に空白や (R) を含むので、必ず Alternative name(@device_...)で指定する
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $ffmpeg = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
             Select-Object -First 1 -ExpandProperty FullName)
}
if (-not $ffmpeg) { Log 'ffmpegが見つからない'; exit 1 }

# ffmpeg -list_devices は結果を stderr に出す。EAP=Stop のままだと 2>&1 が NativeCommandError に
# 化けてここで死ぬ(interview-digest.ps1 と同じ既知パターン)。この区間だけ Continue にする。
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$devs = & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
$ErrorActionPreference = $prevEap
# 2>&1 で来る stderr は ErrorRecord の塊になり、そのまま foreach すると1要素扱いになって
# 行ごとの走査ができない。必ず文字列化してから行に割る。
$devLines = (($devs | Out-String) -split '\r?\n')
$loopAlt = ''; $micAlt = ''; $prev = ''
foreach ($line in $devLines) {
  if ($line -match 'Alternative name "([^"]+)"') {
    # $Matches は次の -match で上書きされるので、内側の判定より先に退避する(2026-08-14に踏んだ)
    $alt = $Matches[1]
    if ($prev -match 'virtual-audio-capturer') { $loopAlt = $alt }
    elseif ($prev -match 'マイク配列|Microphone Array') { $micAlt = $alt }
  }
  $prev = $line
}
if (-not $loopAlt) { Log '!! virtual-audio-capturer が無い。相手の声は録れない' }
if (-not $micAlt)  { Log '!! 内蔵マイク配列が無い' }

$a = @('-hide_banner', '-loglevel', 'warning', '-y')
if ($loopAlt -and $micAlt) {
  $a += @('-f','dshow','-i',("audio=" + $loopAlt), '-f','dshow','-i',("audio=" + $micAlt),
          '-filter_complex','amix=inputs=2:duration=longest:dropout_transition=0')
} elseif ($micAlt) {
  $a += @('-f','dshow','-i',("audio=" + $micAlt))
} else { Log '録れるデバイスが無い'; exit 1 }
$a += @('-ac','1','-ar','16000','-t',"$durSec", $outWav)

$p = Start-Process -FilePath $ffmpeg -ArgumentList $a -WindowStyle Hidden -PassThru
# ロックの持ち主を ffmpeg 本体に移す(この待機用スクリプトはすぐ終了するため)
Set-Content -LiteralPath $lock -Value $p.Id -Encoding ascii
Log ("録音開始 PID={0} 予定ID={1} 終了{2}+{3}分 = {4}秒 -> {5}" -f $p.Id, $AppointmentId, $endAt.ToString('HH:mm'), $BufferMinutes, $durSec, $outWav)

# ショットは録音と同じ stem にする(digest が <stem>-shots を探して顔写真を同梱する規約)
$delays = @()
for ($s = 180; $s -lt $durSec; $s += 300) { $delays += $s }
if ($delays.Count -gt 0) {
  $sp = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList @(
    '-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'capture-meeting-shots.ps1'),
    '-OutDir', $shotsDir, '-DelaySec', ($delays -join ','))
  Log ("スクショ開始 PID={0} {1}枚予定 -> {2}" -f $sp.Id, $delays.Count, $shotsDir)
}

Write-Output ("録音 PID={0} / スクショ PID={1}" -f $p.Id, $(if ($sp) { $sp.Id } else { '-' }))
Write-Output ("出力 {0}" -f $outWav)
Write-Output ("自動停止まで {0} 分" -f [math]::Round($durSec / 60))
