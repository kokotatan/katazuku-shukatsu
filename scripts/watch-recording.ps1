# 録音中に「相手の声が入っていない」状態を見つけて、録り直す見張り。
#
# なぜ要るか(2026-08-18):
# virtual-audio-capturer は "開いた瞬間の既定再生デバイス" に張り付く。人の運用は
# 「会議に入ってからイヤホンを繋ぐ」なので、録音開始(開始5分前)と接続の順序が必ずずれる。
# ずれると相手の声だけが丸ごと無音になる(キャディ振り返り面談: 本人79行/相手0行)。
#
# 見るものを「既定デバイスが変わったか」ではなく「相手の声が入っているか」にした理由:
#  - Windows は既定デバイスを素直にレジストリへ書かない。Role:0 の更新時刻から推測するか
#    C# で IMMDeviceEnumerator を叩くかで、判定ロジックが壊れやすい。
#  - デバイス変更は原因の一つでしかない。Meet が別デバイスへ出した/ミュート/ドライバが寝た、
#    でも同じく無音になる。目的は「相手の声を録る」ことなので、それを直接測る方が正しい。
#  - 検知は ffmpeg 自身の silencedetect がやる。追加プロセスもポーリングも要らない。
#    見張りは stderr ログを追記読みするだけで、間隔を詰める意味がない
#    (無音45秒を待っても損はしない。その45秒は元々無音なので失うものが無い)。
#
# 録り直すと wav が分かれるので、最後に concat して元の名前に戻す。
# digest は <stem>.wav と <stem>-shots を対で見る規約なので、ここを崩さない。
param(
  [Parameter(Mandatory = $true)][int]$FfmpegPid,
  [Parameter(Mandatory = $true)][string]$StderrLog,
  [Parameter(Mandatory = $true)][string]$OutWav,
  # 録音全体の終了時刻(ISO・空白なし)。ここを過ぎたら見張りも終わる。
  [Parameter(Mandatory = $true)][string]$StopIso,
  # 予定の開始時刻(ISO・空白なし)。これより前の無音は「まだ始まっていない」だけなので無視する。
  # LeadMinutes ぶん前録りする仕様上、これが無いと開始前に必ず誤検知する。
  [string]$StartIso = '',
  [string]$LockPath = '',
  [string]$MicPattern = 'マイク配列|Microphone Array',
  [string]$LoopbackPattern = 'virtual-audio-capturer',
  # 録り直しの上限。相手が本当に黙っただけの無音で刻み続けるのを防ぐ。
  [int]$MaxRestarts = 3,
  [int]$PollSec = 15,
  # 出力ファイルがこの秒数まったく増えなければ、録れているふりをして死んでいると見なす。
  # 2026-08-18の実害そのもの: Meetに入った約1分後にVACのキャプチャが切れ、
  # ffmpeg のプロセスは生きたまま書き込みだけが止まった(令和トラベル1.2MB / セーフィー6.5MB)。
  # エラーもログも出ないので、外からサイズを見る以外に気づきようが無い。
  [int]$StallSec = 45,
  # 予定開始からこの秒数は、相手の声が無音でも異常と見なさない。挨拶が始まるまでの間。
  # ここを短くすると、入室待ちや開始直後の沈黙で録り直しが走って上限を食い潰す。
  [int]$GraceSec = 60
)
$ErrorActionPreference = 'Stop'
# 罠2(2026-08-17): ffmpeg はデバイス名をUTF-8で出すが PS5.1 は cp932 で復号する。
# 親で直しても子には効かないので、この見張りプロセスでも入れる。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

. (Join-Path $PSScriptRoot 'lib-audio-devices.ps1')

$repo = Split-Path $PSScriptRoot -Parent
$log = Join-Path $repo 'logs\meeting-record.log'
# ログ書き込みは絶対に録音を巻き添えにしない(meeting-record.log は autopilot・shots・digest が
# 同時に開く)。数回だけ譲って待ち、それでも書けなければ黙って捨てる。
function Log($m) {
  $line = "{0} [watch-rec] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m
  for ($i = 0; $i -lt 5; $i++) {
    try { Add-Content -LiteralPath $log -Value $line -Encoding utf8 -ErrorAction Stop; return }
    catch { Start-Sleep -Milliseconds 200 }
  }
}

# 罠(2026-08-14): [datetime]::Parse("...T19:27:45") は Kind=Unspecified になり、
# .ToLocalTime() を呼ぶと「UTCだった」とみなされて +9時間される。
function ConvertTo-LocalTime([string]$iso) {
  $parsed = [datetime]::Parse($iso, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::None)
  if ($parsed.Kind -eq [DateTimeKind]::Utc) { return $parsed.ToLocalTime() }
  return $parsed
}

$stopAt = ConvertTo-LocalTime $StopIso
$watchFrom = if ($StartIso) { ConvertTo-LocalTime $StartIso } else { Get-Date }

$ffmpeg = Find-Ffmpeg
if (-not $ffmpeg) { Log '!! ffmpegが見つからない。見張りを終える'; exit 1 }

$dir = Split-Path $OutWav -Parent
$stem = [IO.Path]::GetFileNameWithoutExtension($OutWav)

# 録り直しで増えるパート。1本目は元の名前のまま録れているので、それを part1 として数える。
$parts = New-Object System.Collections.ArrayList
[void]$parts.Add($OutWav)
$curPid = $FfmpegPid
$curErr = $StderrLog
$curWav = $OutWav
# パートごとの録音開始時刻。silence_start の相対秒を絶対時刻に直すのに要る。
# 見張りは録音の直後に起動されるので、ここを開始時刻と見なしてよい(誤差は1秒程度)。
$curStartAt = Get-Date
$restarts = 0
# 書き込みが伸びているかを見るための状態。ファイルサイズ読みは1回1ms未満なので、
# ここを速く回しても得は無い(判定に必要な時間の方がずっと長い)。
$lastSize = -1
$lastGrowAt = Get-Date

# 「いま継続している無音」の開始時刻を返す。継続していなければ $null。
#
# 単に silence_start の数を数えてはいけない(2026-08-18に設計を直した): 録音は予定の
# LeadMinutes 前から始まるので、会議前の静かな時間で silence_start が必ず1本記録される。
# 数えるだけだと、予定開始時刻を過ぎた瞬間にその古い1本を拾って録り直しが走り、
# 挨拶前の沈黙でまた走り、上限3回を開始数分で使い切ってしまう。
#
# silencedetect は無音に入ると silence_start: <そのパートの録音開始からの秒>、
# 明けると silence_end を出す。最後が start のままなら今も無音。相対秒にパートの
# 開始時刻を足して絶対時刻に直せば、「面談が始まってから始まった無音か」を判定できる。
function Get-OngoingSilenceStart([string]$path, [datetime]$partStartAt) {
  if (-not (Test-Path $path)) { return $null }
  try {
    # 共有読み。ffmpeg が書いている最中でも掴まずに読む。
    $fs = [IO.File]::Open($path, 'Open', 'Read', 'ReadWrite')
    try {
      $sr = New-Object IO.StreamReader($fs)
      $text = $sr.ReadToEnd()
    } finally { $fs.Dispose() }
  } catch { return $null }
  $ms = [regex]::Matches($text, 'silence_(start|end):\s*(-?[0-9.]+)')
  if ($ms.Count -eq 0) { return $null }
  $last = $ms[$ms.Count - 1]
  if ($last.Groups[1].Value -ne 'start') { return $null }
  $sec = 0.0
  if (-not [double]::TryParse($last.Groups[2].Value, [ref]$sec)) { return $null }
  return $partStartAt.AddSeconds($sec)
}

Log ("見張り開始 PID={0} 監視有効={1}以降 終了={2} -> {3}" -f $curPid, $watchFrom.ToString('HH:mm'), $stopAt.ToString('HH:mm'), $OutWav)

while ((Get-Date) -lt $stopAt) {
  Start-Sleep -Seconds $PollSec
  $alive = [bool](Get-Process -Id $curPid -ErrorAction SilentlyContinue)

  $needRestart = $false
  $why = ''

  # 書き込みが伸びているか。伸びていれば最終成長時刻を進める。
  $size = $lastSize
  if (Test-Path $curWav) { try { $size = (Get-Item $curWav).Length } catch { } }
  if ($size -gt $lastSize) { $lastSize = $size; $lastGrowAt = Get-Date }

  if (-not $alive) {
    if ((Get-Date) -lt $stopAt.AddSeconds(-30)) { $needRestart = $true; $why = 'ffmpegが予定より早く落ちた' }
    else { break }
  }
  # 本命の検知(2026-08-18): Meetに入った約1分後にVACのキャプチャが切れ、プロセスは生きたまま
  # 書き込みだけが止まる。エラーもログも出ないので、外からサイズを見るしか気づく手が無い。
  # 無音判定より先に置く。こちらの方が早く確実に出るため。
  elseif (((Get-Date) - $lastGrowAt).TotalSeconds -ge $StallSec) {
    $needRestart = $true; $why = ("書き込みが{0}秒止まった" -f $StallSec)
  }
  # 書けてはいるが相手の声だけが入っていない = 既定の再生デバイスがずれている。
  #
  # 「無音が始まったのが開始時刻より後か」で切ってはいけない。録音は開始5分前から始まるので、
  # 本当に拾いたい「開始しても相手の声が入らない」ケースも、無音の始まりは開始前になる。
  # 前録りの静けさと区別が付かないので、代わりに開始からの猶予で切る:
  # 開始して GraceSec 経ってもまだ無音が続いているなら、それは前録りではなく異常。
  elseif ((Get-Date) -ge $watchFrom.AddSeconds($GraceSec) -and
          $null -ne ($silAt = Get-OngoingSilenceStart $curErr $curStartAt)) {
    $needRestart = $true; $why = ('相手の声が{0}から無音のまま続いている' -f $silAt.ToString('HH:mm:ss'))
  }

  if (-not $needRestart) { continue }

  if ($restarts -ge $MaxRestarts) {
    Log ("!! {0} が、録り直しは上限{1}回に達したので何もしない。手当てが要る" -f $why, $MaxRestarts)
    break
  }

  # ここから録り直し。今の既定再生デバイスに張り付き直すのが目的なので、
  # デバイスは必ず列挙し直す(古い Alternative name を使い回すと意味が無い)。
  $restarts++
  if ($alive) { Stop-Process -Id $curPid -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 800

  # 直前に ffmpeg を殺したばかりなので、デバイスの解放が間に合わず1回目の列挙が空振りすることがある。
  # ここで諦めると録音が丸ごと止まるため、間を置いて数回試す。
  $dev = $null
  for ($try = 1; $try -le 3; $try++) {
    $dev = Get-DshowAudioAlternatives -Ffmpeg $ffmpeg -MicPattern $MicPattern -LoopbackPattern $LoopbackPattern
    if ($dev.Mic -or $dev.Loopback) { break }
    Log ("デバイスが列挙できない({0}回目)。待って試し直す" -f $try)
    Start-Sleep -Seconds 2
  }
  $remain = [int]($stopAt - (Get-Date)).TotalSeconds
  if ($remain -le 10) { Log '残り時間が無いので録り直さない'; break }

  $partNo = $parts.Count + 1
  $partWav = Join-Path $dir ("{0}.part{1}.wav" -f $stem, $partNo)
  $partErr = Join-Path $dir ("{0}.part{1}.stderr.log" -f $stem, $partNo)
  $args = New-RecordArgs -LoopAlt $dev.Loopback -MicAlt $dev.Mic -DurSec $remain -OutWav $partWav
  if (-not $args) { Log '!! 録れるデバイスが無い。録り直せない'; break }

  $p = Start-Process -FilePath $ffmpeg -ArgumentList $args -WindowStyle Hidden -PassThru -RedirectStandardError $partErr
  $curPid = $p.Id; $curErr = $partErr; $curWav = $partWav
  $lastSize = -1; $lastGrowAt = Get-Date; $curStartAt = Get-Date
  [void]$parts.Add($partWav)
  if ($LockPath) { Set-Content -LiteralPath $LockPath -Value $curPid -Encoding ascii }
  Log ("録り直した({0}回目): {1} -> {2} (残り{3}秒 PID={4} loopback={5})" -f
       $restarts, $why, $partWav, $remain, $curPid, $(if ($dev.Loopback) { 'あり' } else { '無し' }))
}

# 録り直していなければ何もしない。ファイル名も digest の規約どおりのまま。
if ($parts.Count -le 1) { Log '見張り終了(録り直し無し)'; exit 0 }

# 分かれたパートを1本に戻す。digest は <stem>.wav しか見ないので、ここで畳まないと
# 録り直したぶんが議事録から丸ごと落ちる。
if (Get-Process -Id $curPid -ErrorAction SilentlyContinue) {
  Log '最後のパートの終了を待つ'
  Wait-Process -Id $curPid -Timeout 120 -ErrorAction SilentlyContinue
}
Start-Sleep -Seconds 2

$part1 = Join-Path $dir ("{0}.part1.wav" -f $stem)
try {
  Move-Item -LiteralPath $OutWav -Destination $part1 -Force
  $parts[0] = $part1
  $listFile = Join-Path $dir ("{0}.concat.txt" -f $stem)
  # concat デマルチプレクサは各行 file '<path>' の形。シングルクォートはエスケープが要るが、
  # ここのパスは Slug 由来で ' を含まない(record-vac が空白と記号を落としている)。
  #
  # BOMを付けてはいけない(2026-08-18に踏んだ): PowerShell 5.1 の Set-Content -Encoding utf8 は
  # BOM付きで書く。ffmpeg は1行目を '﻿file' という未知キーワードとして弾き、
  # 「Invalid data found when processing input」だけを残して結合が丸ごと落ちる。
  # ps1 は BOM必須(日本語が cp932 で化ける)なのに、この一覧は BOM禁止。逆なので取り違えやすい。
  $listText = (($parts | ForEach-Object { "file '" + ($_ -replace '\\', '/') + "'" }) -join "`n") + "`n"
  [IO.File]::WriteAllText($listFile, $listText, (New-Object Text.UTF8Encoding($false)))

  # 強制停止したパートは WAV ヘッダのデータ長が書き終わっていないが、ffmpeg は
  # 「Ignoring maximum wav data size」と警告しつつ最後まで読める。捨てなくてよい。
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $concatErr = & $ffmpeg -hide_banner -loglevel warning -y -f concat -safe 0 -i $listFile -c copy $OutWav 2>&1
  $ErrorActionPreference = $prevEap
  if (Test-Path $OutWav) {
    $mb = [math]::Round((Get-Item $OutWav).Length / 1MB, 1)
    Log ("パート{0}本を結合した: {1} ({2}MB)。原本は .partN.wav に残してある" -f $parts.Count, $OutWav, $mb)
    Remove-Item -LiteralPath $listFile -Force -ErrorAction SilentlyContinue
  } else {
    # 結合に失敗したら1本目を元の名前に戻す。無音でも digest が回る方がまだ良い。
    Move-Item -LiteralPath $part1 -Destination $OutWav -Force -ErrorAction SilentlyContinue
    # 理由を残す。捨てると次に同じ所で詰まる(BOMで落ちたときログが「失敗した」しか言わなかった)。
    Log ("!! 結合に失敗した。パートは .partN.wav に残っている: {0}" -f (($concatErr | Out-String -Width 4096).Trim()))
  }
} catch {
  Log ("!! 結合中に落ちた: {0}" -f $_.Exception.Message)
}
