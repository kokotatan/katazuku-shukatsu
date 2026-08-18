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
  # 省略した場合は AppointmentId を手がかりにDBから補完する(2026-08-17に追加)。
  # DBからも引けないときだけ即座に録音を開始する。
  # 実害2回: 2026-08-14に18:00開始を17:16から録り44分/85MBを捨て、2026-08-17に12:00開始を11:46から録った。
  [string]$StartIso = '',
  [int]$LeadMinutes = 5,
  [string]$Slug = '',
  [int]$BufferMinutes = 15,
  # dshow のデバイス名にかける正規表現。OSS版と揃えるためパラメータにした(既定は従来と同じ挙動)。
  # 日本語版Windowsの内蔵マイクは「マイク配列」、英語版は "Microphone Array"。
  [string]$MicPattern = 'マイク配列|Microphone Array',
  [string]$LoopbackPattern = 'virtual-audio-capturer'
)
$ErrorActionPreference = 'Stop'
# ffmpeg の -list_devices はデバイス名をUTF-8で出す。PowerShell 5.1 は既定で端末コードページ
# (日本語環境はcp932)で復号するため、「マイク配列 (...インテル® ...)」が文字化けし、
# 下の 'マイク配列' 判定に一致しなくなる(2026-08-17: 内蔵マイクを取り逃していた)。
# meeting-autopilot.ps1 と同じ対処を、別プロセスで動くこちらにも入れる。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
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

# -StartIso を省略されたらDBから補完する(2026-08-17に踏んだ)。
# 省略時は「即座に録音開始」が仕様だが、会議のかなり前に手で叩くと無音を延々と録ることになる。
# 実害は2回: 2026-08-14に18:00開始の説明会を17:16から録って44分/85MBを捨て、
# 2026-08-17には12:00開始の面談を11:46から録った。呼び手の渡し忘れを仕様側で吸収する。
# autopilot は -StartIso を渡すのでここは通らない(meeting-autopilot.ps1 の record-vac 起動部)。
if (-not $StartIso) {
  # ネイティブexeの stderr は EAP=Stop のままだと NativeCommandError に化けて死ぬ。
  # 上の ffmpeg -list_devices と同じ既知パターンなので、この区間だけ Continue にする。
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

# dshow のデバイスは表示名に空白や (R) を含むので、必ず Alternative name(@device_...)で指定する。
# 列挙の罠(Out-String の折り返しで Alternative name が切れる / cp932 でデバイス名が化ける)は
# lib-audio-devices.ps1 に閉じ込めた。録り直す見張りも同じ列挙を使うため、写して片方だけ直す事故を防ぐ。
. (Join-Path $PSScriptRoot 'lib-audio-devices.ps1')
$ffmpeg = Find-Ffmpeg
if (-not $ffmpeg) { Log 'ffmpegが見つからない'; exit 1 }

$dev = Get-DshowAudioAlternatives -Ffmpeg $ffmpeg -MicPattern $MicPattern -LoopbackPattern $LoopbackPattern
$loopAlt = $dev.Loopback; $micAlt = $dev.Mic
if (-not $loopAlt) { Log ("!! ループバック({0})が無い。相手の声は録れない" -f $LoopbackPattern) }
if (-not $micAlt)  { Log ("!! マイク({0})が無い" -f $MicPattern) }

$a = New-RecordArgs -LoopAlt $loopAlt -MicAlt $micAlt -DurSec $durSec -OutWav $outWav
if (-not $a) { Log '録れるデバイスが無い'; exit 1 }

# stderr をファイルに落とす(2026-08-18)。New-RecordArgs が仕込んだ silencedetect の
# silence_start をここに書かせ、見張りは追記読みするだけで「相手の声が無い」を検知できる。
$errLog = Join-Path $intDir ($stem + '.stderr.log')
$p = Start-Process -FilePath $ffmpeg -ArgumentList $a -WindowStyle Hidden -PassThru -RedirectStandardError $errLog
# ロックの持ち主を ffmpeg 本体に移す(この待機用スクリプトはすぐ終了するため)
Set-Content -LiteralPath $lock -Value $p.Id -Encoding ascii
Log ("録音開始 PID={0} 予定ID={1} 終了{2}+{3}分 = {4}秒 -> {5}" -f $p.Id, $AppointmentId, $endAt.ToString('HH:mm'), $BufferMinutes, $durSec, $outWav)

# 見張りを付ける(2026-08-18)。virtual-audio-capturer は開いた瞬間の既定再生デバイスに張り付くが、
# 人の運用は「会議に入ってからイヤホンを繋ぐ」なので、録音開始(開始5分前)と接続の順序は必ずずれる。
# ずれると相手の声だけが無音になる。無音が続いたら今の既定デバイスで録り直させる。
# -ArgumentList は空白で引数を割るので、空白を含みうるパターンだけは明示的に括る(既定値に空白がある)。
$stopIso = $endAt.AddMinutes($BufferMinutes).ToString('yyyy-MM-ddTHH:mm:sszzz')
$watchArgs = @('-NoProfile','-ExecutionPolicy','Bypass','-File',(Join-Path $PSScriptRoot 'watch-recording.ps1'),
               '-FfmpegPid', "$($p.Id)", '-StderrLog', $errLog, '-OutWav', $outWav,
               '-StopIso', $stopIso, '-LockPath', $lock,
               '-MicPattern', ('"' + $MicPattern + '"'), '-LoopbackPattern', ('"' + $LoopbackPattern + '"'))
if ($StartIso) { $watchArgs += @('-StartIso', $StartIso) }
$wp = Start-Process powershell.exe -WindowStyle Hidden -PassThru -ArgumentList $watchArgs
Log ("見張り開始 PID={0} 無音が続いたら今の既定デバイスで録り直す" -f $wp.Id)

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
