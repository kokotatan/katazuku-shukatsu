# check-loopback: 面談の直前に「相手の声が本当に録れる状態か」を10秒で確かめる。
#
# なぜ要るか(2026-08-17に踏んだ): virtual-audio-capturer は「開いた瞬間の既定再生デバイス」の
# ループバックに張り付く。デバイス自体は列挙できるので record-vac は正常に起動し、ログにも
# 警告が出ない。それでいて既定デバイスが実際の出力先とずれていると、相手の声だけが
# まるごと無音になる。キャディの振り返り面談は、これで先方の発言が1文字も残らなかった。
#
# ここでは実際に音を鳴らして、ループバックがそれを拾えるかを測る。拾えれば本番でも拾える。
#
# 使い方(面談の直前・ヘッドセットを挿した状態で):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check-loopback.ps1
#
# 注意: 短い通知音が既定の出力先から鳴る。ヘッドセットを付けたまま実行すること
#       (自分の耳で鳴ったのが聞こえるかどうかも、それ自体が確認になる)。
$ErrorActionPreference = 'Stop'
# ffmpeg はデバイス名をUTF-8で出す。PS 5.1 の既定(cp932)だと日本語名が化けて一致しない。
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $ffmpeg = (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
             Select-Object -First 1 -ExpandProperty FullName)
}
if (-not $ffmpeg) { Write-Output 'NG: ffmpeg が見つかりません'; exit 1 }

# デバイス列挙。-Width を付けないと非対話ホストで80桁に折り返されて Alternative name を拾えない。
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$devs = & $ffmpeg -hide_banner -list_devices true -f dshow -i dummy 2>&1
$ErrorActionPreference = $prevEap
$devLines = (($devs | Out-String -Width 4096) -split '\r?\n')
$loopAlt = ''; $micAlt = ''; $prev = ''
foreach ($line in $devLines) {
  if ($line -match 'Alternative name "([^"]+)"') {
    $alt = $Matches[1]
    if ($prev -match 'virtual-audio-capturer') { $loopAlt = $alt }
    elseif ($prev -match 'マイク配列|Microphone Array') { $micAlt = $alt }
  }
  $prev = $line
}

Write-Output ('ループバック(相手の声): {0}' -f $(if ($loopAlt) { '検出' } else { '**見つからない**' }))
Write-Output ('マイク(自分の声)      : {0}' -f $(if ($micAlt)  { '検出' } else { '**見つからない**' }))
if (-not $loopAlt) {
  Write-Output ''
  Write-Output 'NG: virtual-audio-capturer が無い。このまま録っても相手の声は入りません。'
  exit 1
}

# 実際に鳴らして拾えるか測る。録音を先に立ち上げ、1秒後に通知音を鳴らす。
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('loopback-check-{0}.wav' -f [Guid]::NewGuid().ToString('N').Substring(0,8))
$args = @('-hide_banner','-loglevel','error','-y','-f','dshow','-i',("audio=" + $loopAlt),
          '-ac','1','-ar','16000','-t','4', $tmp)
$proc = Start-Process -FilePath $ffmpeg -ArgumentList $args -WindowStyle Hidden -PassThru

Start-Sleep -Seconds 1
# System.Media.SoundPlayer は既定の再生デバイスへ出す。つまり本番の相手の声と同じ経路を通る。
$wav = Join-Path $env:WINDIR 'Media\Windows Ding.wav'
try {
  if (Test-Path $wav) {
    $player = New-Object System.Media.SoundPlayer $wav
    1..3 | ForEach-Object { $player.PlaySync() }
  } else {
    Write-Output '注意: 通知音のwavが見つからないため、手元で何か音を鳴らしてください(残り3秒)'
  }
} catch {
  Write-Output ('注意: 音を鳴らせませんでした({0})。手元で何か再生してください' -f $_.Exception.Message)
}

$proc.WaitForExit(15000) | Out-Null
if (-not (Test-Path $tmp)) { Write-Output 'NG: 録音ファイルができませんでした'; exit 1 }

$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$vol = & $ffmpeg -hide_banner -nostats -i $tmp -af volumedetect -f null - 2>&1
$ErrorActionPreference = $prevEap
$volText = ($vol | Out-String -Width 4096)
Remove-Item $tmp -Force -ErrorAction SilentlyContinue

$mean = $null
if ($volText -match 'mean_volume:\s*(-?[\d.]+) dB') { $mean = [double]$Matches[1] }
if ($null -eq $mean) { Write-Output 'NG: 音量を測れませんでした'; exit 1 }

Write-Output ''
Write-Output ('ループバックの平均音量: {0} dB' -f $mean)
# 完全な無音(digital silence)は -91dB。鳴らした音が乗っていれば明確に上回る。
if ($mean -gt -80) {
  Write-Output 'OK: 既定の出力先の音がループバックに乗っています。このまま録れば相手の声が入ります。'
  exit 0
}
Write-Output ''
Write-Output 'NG: 音を鳴らしたのにループバックが無音です。'
Write-Output '    virtual-audio-capturer が今の出力先とは別のデバイスに張り付いています。'
Write-Output '    対処: サウンド設定で出力先(ヘッドセット)を明示的に選び直してから、もう一度これを実行する。'
Write-Output '    直らなければ、その面談は録音に頼らずメモを取る前提で臨むこと。'
exit 1
