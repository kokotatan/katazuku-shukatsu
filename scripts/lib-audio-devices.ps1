# dshow の音声デバイスを引くための共通部品。
#
# なぜ切り出したか(2026-08-18): 録音中に既定の再生デバイスが変わると
# virtual-audio-capturer は古いデバイスに張り付いたままになり、相手の声だけが無音になる。
# 録り直しを watch-recording.ps1 に持たせた結果、デバイス列挙が record-vac.ps1 と2箇所に
# 必要になった。ここには過去に踏んだ罠が2つ埋まっているので、写して片方だけ直す事故を防ぐ。
#
# 罠1(2026-08-17に面談1本を失った): Out-String は既定でホストのコンソール幅に折り返す。
#   タスクスケジューラ経由の非対話ホストは80桁なので、80桁を超える
#   `Alternative name "@device_..."` が改行され、正規表現が閉じ引用符を見つけられない。
#   → -Width 4096 が必須。
# 罠2(同日): ffmpeg はデバイス名をUTF-8で出すが PowerShell 5.1 は端末コードページ(cp932)で
#   復号するため「マイク配列」が化けて一致しない。→ 呼び手が
#   [Console]::OutputEncoding = UTF8 を"そのプロセスで"入れる必要がある。親だけでは効かない。

function Find-Ffmpeg {
  $p = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
  if ($p) { return $p }
  return (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
          Select-Object -First 1 -ExpandProperty FullName)
}

# 表示名ではなく Alternative name(@device_...) を返す。表示名は空白や (R) を含み、
# ffmpeg の -i audio=... にそのまま渡すと壊れるため。
function Get-DshowAudioAlternatives {
  param(
    [Parameter(Mandatory = $true)][string]$Ffmpeg,
    [string]$MicPattern = 'マイク配列|Microphone Array',
    [string]$LoopbackPattern = 'virtual-audio-capturer'
  )
  # ネイティブexeの stderr は EAP=Stop のままだと NativeCommandError に化けて死ぬ。
  # -list_devices は結果を stderr に出すので、この区間だけ Continue にする。
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  $devs = & $Ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
  $ErrorActionPreference = $prevEap

  # 2>&1 で来る stderr は ErrorRecord の塊で、そのまま foreach すると1要素扱いになる。
  # 必ず文字列化してから行に割る(-Width は罠1のため必須)。
  $lines = (($devs | Out-String -Width 4096) -split '\r?\n')
  $loopAlt = ''; $micAlt = ''; $prev = ''
  foreach ($line in $lines) {
    if ($line -match 'Alternative name "([^"]+)"') {
      # $Matches は次の -match で上書きされるので、内側の判定より先に退避する
      $alt = $Matches[1]
      if ($prev -match $LoopbackPattern) { $loopAlt = $alt }
      elseif ($prev -match $MicPattern) { $micAlt = $alt }
    }
    $prev = $line
  }
  return [pscustomobject]@{ Loopback = $loopAlt; Mic = $micAlt }
}

# 録音1本ぶんの ffmpeg 引数を組む。
# 相手の声(loopback)だけを silencedetect に通すのが肝(2026-08-18)。
# amix した後を監視すると自分の相槌で無音判定が消えてしまい、
# 「相手の声だけが入っていない」という当の事故を検知できない。
function New-RecordArgs {
  param(
    [string]$LoopAlt,
    [string]$MicAlt,
    [Parameter(Mandatory = $true)][int]$DurSec,
    [Parameter(Mandatory = $true)][string]$OutWav,
    # 無音がこの秒数続いたら stderr に silence_start が出る。監視側の録り直し判定に使う。
    # 面談で相手が45秒まるごと黙るのは稀。短くすると沈黙のたびに録り直してファイルが刻まれる。
    [int]$SilenceSec = 45,
    [string]$SilenceDb = '-50dB',
    # 相手と自分を混ぜず、L=相手 / R=自分 の2chで残す(2026-08-18に既定化)。
    # 混ぜると後段で「誰が話したか」を内容から推測するしかなくなり、話者ラベルが当たらない
    # (実際 8/14 Sansan の文字起こしは「話者ラベルは音響分離ではなく内容からの推定」と
    # 断り書きが入っている)。分けて録れば話者分離は物理的に確定し、
    # 発話占有率や一発話の長さが推定でなく実測になる。相手の声が入っていない事故も
    # Lチャンネルの音量を見るだけで判定できる。容量は倍(16kHz/16bit/2ch = 3.8MB/分)。
    [switch]$Mono
  )
  # silencedetect は info レベルでログを出すので、従来の warning では拾えない。
  # ただし info にすると進捗行(size=... time=...)が毎秒2行出てログが肥大するため -nostats で止める。
  # 実測: 26秒で99行(ほぼ進捗行)。1時間の面談なら1万行を超える。
  $a = @('-hide_banner', '-loglevel', 'info', '-nostats', '-y')
  $chans = 2
  if ($LoopAlt -and $MicAlt) {
    $a += @('-f','dshow','-i',("audio=" + $LoopAlt), '-f','dshow','-i',("audio=" + $MicAlt))
    # [0:a]=loopback を2本に割る。片方は本編、もう片方は監視専用。
    # 監視側は anullsink に捨てる。silencedetect はログを出すのが仕事で、音は要らない。
    # 監視は必ず loopback 単体に掛ける。混ぜた後だと自分の相槌で無音判定が消え、
    # 「相手の声だけが入っていない」という当の事故を拾えない。
    $mixExpr = if ($Mono) {
      # 従来どおり1本に混ぜる。話者分離はできなくなるので、容量を惜しむとき以外は使わない。
      '[mix][1:a]amix=inputs=2:duration=longest:dropout_transition=0[out]'
    } else {
      # L=相手 / R=自分。両入力ともステレオで来るので、先に1chへ落としてから合流させる。
      # 合流は amerge ではなく join を使う(2026-08-18に実測して差し替えた)。
      # amerge は入力のチャンネルレイアウトを見て並べ直すため、1ch同士を渡しても
      # 期待どおり L/R に割り当たらず、無音のはずのLに -28dB が乗った(=分離できていない)。
      # join は inputs と channel_layout を明示して固定できる。
      '[mix]pan=mono|c0=c0[l];[1:a]pan=mono|c0=c0[r];[l][r]join=inputs=2:channel_layout=stereo[out]'
    }
    if ($Mono) { $chans = 1 }
    $a += @('-filter_complex',
            ("[0:a]asplit=2[mix][mon];{0};[mon]silencedetect=n={1}:d={2},anullsink" -f $mixExpr, $SilenceDb, $SilenceSec))
    $a += @('-map','[out]')
  } elseif ($MicAlt) {
    # ループバックが取れないときは自分の声だけでも残す。相手の声が無いので silencedetect も付けない。
    # 片側しか無いので2chにする意味も無い。
    $a += @('-f','dshow','-i',("audio=" + $MicAlt))
    $chans = 1
  } else {
    return $null
  }
  $a += @('-ac',"$chans",'-ar','16000','-t',"$DurSec", $OutWav)
  return $a
}
