# 面談の成果物を、正本DBのある機械へ運ぶための面談バンドル(zip)を作る共通処理(録音機側)。
#
# バンドルの中身:
#   manifest.json            各ファイルの種別・sha256・サイズ(受け側で欠損・取り違えを検知する)
#   interview.json           DB反映用の議事録JSON(db-json。ちょうど1件)
#   transcript/<名前>        文字起こし(任意)
#   shots/<名前>             面談スクリーンショット・顔写真(任意。people[].photoPath は同名で付け替えられる)
#   audio/<名前>             音声の原本(任意。FLACへ可逆圧縮して運ぶ)
#
# 転送の手段は問わない(USBメモリ、共有フォルダ、scp など)。受け側では
#   npm run interview:apply -- <zipのパス>
# が manifest を検査してから反映する。流れは docs/INTERVIEW-BUNDLE.md。
#
# 音声を可逆圧縮(FLAC)にする理由:
#   - 16kHz/16bit PCM のままだと1時間で約230MB になる
#   - FLAC は可逆なので、聞き直しや文字起こしのやり直しでも原本と同じ音が得られる
#   - opus 等の非可逆は容量では有利だが、判断材料になる根拠音声を劣化させたくない
#
# 使い方(ドットソースして関数を呼ぶ。単発なら scripts\new-interview-bundle.ps1 を使う):
#   . .\scripts\lib-interview-bundle.ps1
#   New-KatazukuInterviewBundle -DbJsonPath logs\interviews\example-db.json -ShotsDirectory logs\interviews\example-shots

function Get-KatazukuFfmpegPath {
  $p = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
  if ($p) { return $p }
  # winget で入れた直後は PATH が更新されていないことがあるため、WinGet の置き場も探す。
  $cand = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe") +
          (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue |
            ForEach-Object FullName)
  return ($cand | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1)
}

<#
.SYNOPSIS
  wav を可逆圧縮の FLAC へ変換する。失敗したら元の wav のパスを返す(録音を失わない)。
.DESCRIPTION
  -compression_level 8 は FLAC の最高圧縮。16kHz の音声では概ね元の45〜60%になる。
  変換に成功しても元の wav は消さない。消す判断は呼び出し側(転送成功の確認後)に委ねる。
#>
function Convert-KatazukuAudioToFlac {
  param(
    [Parameter(Mandatory = $true)][string]$WavPath,
    [string]$FfmpegPath = ''
  )
  if (-not (Test-Path -LiteralPath $WavPath)) { return $null }
  if ([IO.Path]::GetExtension($WavPath).ToLowerInvariant() -eq '.flac') { return $WavPath }
  $ffmpeg = if ($FfmpegPath) { $FfmpegPath } else { Get-KatazukuFfmpegPath }
  if (-not $ffmpeg) { return $WavPath }

  $flacPath = [IO.Path]::ChangeExtension($WavPath, '.flac')
  if (Test-Path -LiteralPath $flacPath) { return $flacPath }

  # ネイティブ exe の stderr を EAP=Stop のまま受けると NativeCommandError で止まるため、この区間だけ緩める。
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $ffmpeg -hide_banner -loglevel error -y -i $WavPath -c:a flac -compression_level 8 $flacPath 2>&1 | Out-Null
    $code = $LASTEXITCODE
  } finally { $ErrorActionPreference = $prevEap }

  if ($code -ne 0 -or -not (Test-Path -LiteralPath $flacPath)) {
    Remove-Item -LiteralPath $flacPath -Force -ErrorAction SilentlyContinue
    return $WavPath
  }
  # 出来上がりが元より大きい(既に圧縮済み等)なら意味が無いので捨てる。
  if ((Get-Item -LiteralPath $flacPath).Length -ge (Get-Item -LiteralPath $WavPath).Length) {
    Remove-Item -LiteralPath $flacPath -Force -ErrorAction SilentlyContinue
    return $WavPath
  }
  return $flacPath
}

function Get-KatazukuFileSha256 {
  param([Parameter(Mandatory = $true)][string]$Path)
  return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

<#
.SYNOPSIS
  正本DBへ渡す面談バンドル(zip)を作り、その絶対パスを返す。
.DESCRIPTION
  manifest の runId / appointmentId / careerMeetingId は DB反映JSON から取る。
  受け側は manifest と JSON の一致を確かめるので、別の値(例えば agent 実行の台帳ID)を
  manifest に入れると反映が必ず拒否される。引数で明示した場合も JSON と一致しなければここで止める。

  バンドル内のパスは種別ごとのフラットな相対パスに正規化する。日本語ファイル名は zip の
  UTF-8 エントリ名でそのまま運ぶ。
#>
function New-KatazukuInterviewBundle {
  param(
    [Parameter(Mandatory = $true)][string]$DbJsonPath,
    [string]$RunId = '',
    [int]$AppointmentId = -1,
    [int]$CareerMeetingId = -1,
    [string]$TranscriptPath = '',
    [string]$ShotsDirectory = '',
    [string]$AudioPath = '',
    [string]$OutputZipPath = ''
  )
  if (-not (Test-Path -LiteralPath $DbJsonPath)) { throw "DB反映JSONがありません: $DbJsonPath" }
  $DbJsonPath = (Resolve-Path -LiteralPath $DbJsonPath).Path
  $interview = Get-Content -LiteralPath $DbJsonPath -Raw -Encoding UTF8 | ConvertFrom-Json

  $jsonRunId = [string]$interview.runId
  if (-not $jsonRunId) { throw "DB反映JSONに runId がありません: $DbJsonPath" }
  if ($RunId -and $RunId -ne $jsonRunId) {
    throw "runId がDB反映JSONと一致しません(指定=$RunId JSON=$jsonRunId)。manifestにはJSONのrunIdを使います"
  }
  $jsonAppointmentId = if ($interview.appointmentId) { [int]$interview.appointmentId } else { 0 }
  $jsonCareerMeetingId = if ($interview.careerMeetingId) { [int]$interview.careerMeetingId } else { 0 }
  if ($AppointmentId -ge 0 -and $AppointmentId -ne $jsonAppointmentId) {
    throw "appointmentId がDB反映JSONと一致しません(指定=$AppointmentId JSON=$jsonAppointmentId)"
  }
  if ($CareerMeetingId -ge 0 -and $CareerMeetingId -ne $jsonCareerMeetingId) {
    throw "careerMeetingId がDB反映JSONと一致しません(指定=$CareerMeetingId JSON=$jsonCareerMeetingId)"
  }

  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem

  # 同梱するファイルを (絶対パス, バンドル内の相対パス, 種別) で並べる。
  $staged = New-Object System.Collections.Generic.List[object]
  $staged.Add([pscustomobject]@{ Absolute = $DbJsonPath; Relative = 'interview.json'; Kind = 'db-json' }) | Out-Null
  if ($TranscriptPath -and (Test-Path -LiteralPath $TranscriptPath)) {
    $staged.Add([pscustomobject]@{
      Absolute = (Resolve-Path -LiteralPath $TranscriptPath).Path
      Relative = 'transcript/' + [IO.Path]::GetFileName($TranscriptPath)
      Kind     = 'transcript'
    }) | Out-Null
  }
  if ($ShotsDirectory -and (Test-Path -LiteralPath $ShotsDirectory)) {
    foreach ($shot in Get-ChildItem -LiteralPath $ShotsDirectory -File) {
      $staged.Add([pscustomobject]@{ Absolute = $shot.FullName; Relative = 'shots/' + $shot.Name; Kind = 'shot' }) | Out-Null
    }
  }
  if ($AudioPath -and (Test-Path -LiteralPath $AudioPath)) {
    $staged.Add([pscustomobject]@{
      Absolute = (Resolve-Path -LiteralPath $AudioPath).Path
      Relative = 'audio/' + [IO.Path]::GetFileName($AudioPath)
      Kind     = 'audio'
    }) | Out-Null
  }

  # PowerShell 7.5 では List[object] をそのまま @() で配列化すると "Argument types do not match" に
  # なることがある。パイプラインで通常の object[] に確定してから manifest へ載せる。
  $manifestFiles = [object[]]($staged | ForEach-Object {
    [ordered]@{
      path   = $_.Relative
      kind   = $_.Kind
      sha256 = (Get-KatazukuFileSha256 -Path $_.Absolute)
      bytes  = [int64](Get-Item -LiteralPath $_.Absolute).Length
    }
  })
  $manifest = [ordered]@{
    schemaVersion   = 1
    runId           = $jsonRunId
    appointmentId   = $jsonAppointmentId
    careerMeetingId = $jsonCareerMeetingId
    sourceHost      = [Environment]::MachineName
    createdAt       = [datetimeoffset]::Now.ToString('o')
    files           = $manifestFiles
  }

  $zipPath = if ($OutputZipPath) { [IO.Path]::GetFullPath($OutputZipPath) } else {
    Join-Path ([IO.Path]::GetTempPath()) ('katazuku-interview-' + [guid]::NewGuid().ToString('N') + '.zip')
  }
  if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

  $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
  try {
    foreach ($entry in $staged) {
      [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $entry.Absolute, $entry.Relative) | Out-Null
    }
    # manifest は zip 内に直接書く(一時ファイルを作らない)。BOM無しUTF-8。
    $manifestEntry = $zip.CreateEntry('manifest.json')
    $stream = $manifestEntry.Open()
    try {
      $json = ($manifest | ConvertTo-Json -Depth 6)
      $bytes = (New-Object Text.UTF8Encoding($false)).GetBytes($json)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
  } finally { $zip.Dispose() }

  return $zipPath
}
