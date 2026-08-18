# record-vac: オンライン面談を「相手の声つき」で確実に録る(Windows専用)。
#
# なぜこの構成か。ヘッドセットやイヤホンを使うと、内蔵マイクだけを掴む録音では相手の声が
# 一切入らない。かといって Windows の Game Bar は、会議ウィンドウに当てると数分ごとに
# 分割されて大半を失い、別の安定したウィンドウに当てると「録画対象アプリの音しか拾わない」
# ため相手の声が入らない。どちらの設定でも面談の記録としては使えなかった。
#
# ここでは dshow の2系統を amix で1本にする:
#   - virtual-audio-capturer  = 既定の再生デバイスのループバック(= 相手の声)
#   - 内蔵マイク              = 自分の声
# ループバックを使うので、出力先がヘッドセットでもBluetoothでも相手の声が録れる。
# 実測の目安: 無音 -91dB / 相手が話している間 -25〜-30dB、16kHz mono で 1分あたり約1.9MB。
#
# 前提:
#   - ffmpeg が PATH にあること(winget の Gyan.FFmpeg なら自動で拾う)
#   - virtual-audio-capturer が入っていること(screen-capture-recorder 同梱の dshow フィルタ)
#     入っていない場合は内蔵マイクだけで録音を続行するが、相手の声は入らない
#
# 録音長は「予定の終了時刻 + BufferMinutes - 現在時刻」で決める。固定の -t は使わない
# (固定長にすると、録音開始が早まった分だけ終了が前倒しになり、逆質問パートを丸ごと失う)。
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\record-vac.ps1 `
#       -AppointmentId 42 -EndIso 2026-08-14T19:30:00+09:00 -Slug acme-1st
param(
  [Parameter(Mandatory = $true)][int]$AppointmentId,
  # 予定の終了時刻(ISO・空白なし。例 2026-08-14T19:30:00+09:00)。
  [Parameter(Mandatory = $true)][string]$EndIso,
  # 予定の開始時刻(ISO・空白なし)。渡すと開始 LeadMinutes 前まで待ってから録り始める。
  # 省略した場合は AppointmentId を手がかりにDBから補完する。
  # DBからも引けないときだけ即座に録音を開始する。
  [string]$StartIso = '',
  [int]$LeadMinutes = 5,
  [string]$Slug = '',
  [int]$BufferMinutes = 15,
  # dshow のデバイス名にかける正規表現。日本語版Windowsの内蔵マイクは「マイク配列」、
  # 英語版は "Microphone Array" なので既定で両方を見る。別のマイクを使うなら上書きする。
  [string]$MicPattern = 'マイク配列|Microphone Array',
  [string]$LoopbackPattern = 'virtual-audio-capturer'
)
$ErrorActionPreference = 'Stop'
# ffmpeg の -list_devices はデバイス名をUTF-8で出す。PowerShell 5.1 は既定で端末コードページ
# (日本語環境は cp932)で復号するため、「マイク配列 (...インテル(R) ...)」が文字化けし、
# 下の $MicPattern 判定に一致しなくなる。結果、内蔵マイクを取り逃す。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$repo = Split-Path $PSScriptRoot -Parent
$intDir = Join-Path $repo 'logs\interviews'
if (-not (Test-Path $intDir)) { New-Item -ItemType Directory $intDir -Force | Out-Null }
$log = Join-Path $repo 'logs\meeting-record.log'
# ログ書き込みは絶対に録音を巻き添えにしない。meeting-record.log はスクショ側とも同時に開くため、
# EAP=Stop のまま Out-File すると「使用中」で録音起動ごと落ちる。
# 数回だけ譲って待ち、それでも書けなければ黙って捨てる。
function Log($m) {
  $line = "{0} [record-vac] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  for ($i = 0; $i -lt 5; $i++) {
    try { Add-Content -LiteralPath $log -Value $line -Encoding utf8 -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 200 }
  }
}

# ISO文字列をローカル時刻として正しく読む。
# 罠: [datetime]::Parse("2026-08-14T19:27:45") は Kind=Unspecified になり、
# そこへ .ToLocalTime() を呼ぶと「UTCだった」とみなされて時差ぶん足される。
# 実際に、1分のはずの録音長が541分と算出されたことがある。
# オフセット付き("+09:00")のときだけ変換する。
function ConvertTo-LocalTime([string]$iso) {
  $parsed = [datetime]::Parse($iso, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
  if ($parsed.Kind -eq [DateTimeKind]::Utc) { return $parsed.ToLocalTime() }
  return $parsed  # Unspecified はそのままローカルとして扱う / Local は変換済み
}

# 二重録音ガード: 同じ会議を自動起動と手動起動で2本録ってしまい、
# 178MBと235MBの重複ができたことがある。予定IDごとにロックを持ち、
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

# -StartIso を省略されたらDBから補完する。
# 省略時は「即座に録音開始」が仕様だが、会議のかなり前に手で叩くと無音を延々と録ることになる
# (18:00開始の説明会を17:16から録って44分/85MBを捨てたことがある)。呼び手の渡し忘れを仕様側で吸収する。
if (-not $StartIso) {
  # ネイティブexeの stderr は EAP=Stop のままだと NativeCommandError に化けて死ぬ。
  # 下の ffmpeg -list_devices と同じ既知パターンなので、この区間だけ Continue にする。
  $prevEapT = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $timesJson = ''
  try {
    $timesJson = & node (Join-Path $PSScriptRoot 'appointment-times.mjs') $AppointmentId 2>$null | Select-Object -Last 1
  } catch { $timesJson = '' }
  $ErrorActionPreference = $prevEapT
  if ($timesJson) {
    try {
      $times = $timesJson | ConvertFrom-Json
      if ($times.startIso) {
        $StartIso = $times.startIso
        Log ("-StartIso が無いのでDBから補完した(予定{0}): {1}" -f $AppointmentId, $StartIso)
      }
    } catch { Log ("予定時刻のJSONが読めない: {0}" -f $timesJson) }
  }
  # 引けなければ即時開始のまま進む。前録りの無駄より、録り逃しの方が損害が大きい。
  if (-not $StartIso) { Log '!! -StartIso が無くDBからも引けない。即座に録音を開始する(前録りに注意)' }
}

# 開始時刻が分かっていれば、開始 LeadMinutes 前まで待つ。無駄な前録りを避ける。
if ($StartIso) {
  $startAt = ConvertTo-LocalTime $StartIso
  $beginAt = $startAt.AddMinutes(-$LeadMinutes)
  $wait = [int]($beginAt - (Get-Date)).TotalSeconds
  if ($wait -gt 0) {
    Log ("開始{0}の{1}分前({2})まで待機する: {3}秒" -f $startAt.ToString('HH:mm'), $LeadMinutes, $beginAt.ToString('HH:mm'), $wait)
    # 一気にSleepせず分割する(長時間Sleepはスリープ復帰でずれることがある)
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
# 出力パスとスクリプト引数の両方が壊れる。
if (-not $Slug) { $Slug = 'meeting-' + $AppointmentId }
# 非ASCIIは残す。壊すのは「空白」と、ファイル名に使えない文字だけ。
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
# 化けてここで死ぬ。この区間だけ Continue にする。
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$devs = & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
$ErrorActionPreference = $prevEap
# 2>&1 で来る stderr は ErrorRecord の塊になり、そのまま foreach すると1要素扱いになって
# 行ごとの走査ができない。必ず文字列化してから行に割る。
# -Width は必須。Out-String は既定でホストのコンソール幅(タスクスケジューラ経由の非対話ホスト
# では80桁)に折り返すため、80桁を超える Alternative name の @device_... が途中で改行され、
# 'Alternative name "([^"]+)"' が閉じ引用符を見つけられず不一致になる。
# 対話シェルから手で叩くと窓が広くて再現しないので、自動実行のときだけ
# 「デバイスが無い」と誤判定して録音ごと落ちる形になる。
$devLines = (($devs | Out-String -Width 4096) -split '\r?\n')
$loopAlt = ''; $micAlt = ''; $prev = ''
foreach ($line in $devLines) {
  if ($line -match 'Alternative name "([^"]+)"') {
    # $Matches は次の -match で上書きされるので、内側の判定より先に退避する
    $alt = $Matches[1]
    if ($prev -match $LoopbackPattern) { $loopAlt = $alt }
    elseif ($prev -match $MicPattern) { $micAlt = $alt }
  }
  $prev = $line
}
if (-not $loopAlt) { Log ("!! ループバック({0})が無い。相手の声は録れない" -f $LoopbackPattern) }
if (-not $micAlt)  { Log ("!! マイク({0})が無い" -f $MicPattern) }

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

# ショットは録音と同じ stem にする(<stem>-shots を探して顔写真を切り出す規約)
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
