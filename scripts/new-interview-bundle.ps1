# new-interview-bundle: 録音機で面談バンドル(zip)を1つ作る(Windows)。
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\new-interview-bundle.ps1 `
#       -DbJsonPath logs\interviews\example-db.json `
#       -TranscriptPath logs\interviews\example-raw.txt `
#       -ShotsDirectory logs\interviews\example-shots `
#       -AudioPath logs\interviews\example.wav `
#       -OutputZipPath example-bundle.zip
#
# runId と予定ID は DB反映JSON から取る(manifest と JSON が食い違うと受け側で拒否されるため)。
# -AudioPath に wav を渡すと、ffmpeg があれば FLAC へ可逆圧縮してから同梱する。元の wav は消さない。
# できた zip を正本DBのある機械へ運び、そこで npm run interview:apply -- <zip> を実行する。
# 詳しくは docs/INTERVIEW-BUNDLE.md。
param(
  [Parameter(Mandatory = $true)][string]$DbJsonPath,
  [string]$TranscriptPath = '',
  [string]$ShotsDirectory = '',
  [string]$AudioPath = '',
  [string]$OutputZipPath = '',
  # 音声を wav のまま運ぶ(FLAC へ変換しない)。
  [switch]$NoFlac
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-interview-bundle.ps1')

$audio = $AudioPath
$converted = ''
if ($AudioPath -and -not $NoFlac) {
  # 変換前から同名の FLAC があるなら、それは本人のファイルなので後で消さない。
  $flacExisted = Test-Path -LiteralPath ([IO.Path]::ChangeExtension($AudioPath, '.flac'))
  $audio = Convert-KatazukuAudioToFlac -WavPath $AudioPath
  if ($audio -and $audio -ne $AudioPath -and -not $flacExisted) { $converted = $audio }
}

try {
  $zip = New-KatazukuInterviewBundle -DbJsonPath $DbJsonPath -TranscriptPath $TranscriptPath `
    -ShotsDirectory $ShotsDirectory -AudioPath $audio -OutputZipPath $OutputZipPath
} finally {
  # 変換で作った FLAC は zip に入ったので片付ける(元の wav は残す)。
  if ($converted) { Remove-Item -LiteralPath $converted -Force -ErrorAction SilentlyContinue }
}
$zip
