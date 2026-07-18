# interview-digest: turn an interview recording into structured notes + forward-looking insights.
#
# Pipeline: (video/audio file) -> [ffmpeg extract audio if needed] -> voicebox local Whisper
#           -> claude -p structures into chrome-prompts/interview-notes.local.md + writes insights.
# Free / local / within the Claude subscription. No cloud audio APIs.
#
# Recording the call (both sides) on Windows: use the built-in Game Bar (Win+Alt+R) on the
# meeting window. In Game Bar settings set "Audio to record = All" and mic ON so the other
# party's voice (system audio) and yours (mic) are both captured. It saves an .mp4 to
# %USERPROFILE%\Videos\Captures. Pass that .mp4 here; audio is extracted automatically.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\interview-digest.ps1 -InputPath "C:\...\recording.mp4"
param(
  [Parameter(Mandatory = $true)]
  [Alias('AudioPath')]
  [string]$InputPath,
  # 既定では議事録が取れたら中間ファイル(チャンク)と巨大な元録画を消してディスクを節約する。
  # 元動画を残したいときだけ -KeepSource を付ける。聞き直し用の16kHz wavと文字起こしtxtは常に残る。
  [switch]$KeepSource
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (-not (Test-Path $InputPath)) { Write-Error "input file not found: $InputPath"; exit 1 }
$InputPath = (Resolve-Path $InputPath).Path

$logDir = Join-Path $repo 'logs'
$intDir = Join-Path $logDir 'interviews'
foreach ($d in @($logDir, $intDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory $d | Out-Null } }
$logFile = Join-Path $logDir ("interview-digest-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

# Locate ffmpeg (PATH may not be refreshed yet after a winget install, so also check the WinGet Links shim).
# Needed both to extract audio from video and to split audio into Whisper-sized chunks.
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $cand = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe") +
          (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $ffmpeg = $cand | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ffmpeg) { Write-Error "need ffmpeg. Install: winget install Gyan.FFmpeg"; exit 1 }

# voicebox must already be listening BEFORE claude starts: a claude session binds its MCP servers at
# launch, so starting voicebox afterwards does not give that session the transcribe tool. Without this
# check the run fails silently in its worst form -- chunking "succeeds", every transcribe call is a
# no-op, and no transcript is ever written (hit 2026-07-15 and again 2026-07-16; see PROGRESS.md).
$voiceboxPort = 17493
function Test-Voicebox { try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', $voiceboxPort); return $true } catch { return $false } }
if (-not (Test-Voicebox)) {
  $vb = @("$env:ProgramFiles\Voicebox\voicebox.exe", "${env:ProgramFiles(x86)}\Voicebox\voicebox.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vb) { Write-Error "voicebox is not running and voicebox.exe was not found. Start Voicebox, then re-run."; exit 1 }
  "voicebox is down. starting $vb ..."
  Start-Process $vb -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Voicebox) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Test-Voicebox)) { Write-Error "voicebox did not open port $voiceboxPort within 60s. Start it manually, then re-run."; exit 1 }
  "voicebox is up (port $voiceboxPort)"
}

# voicebox accepts these audio formats directly; anything else (mp4/mkv/mov...) is extracted first.
$audioExts = @('.wav', '.mp3', '.m4a', '.webm', '.opus', '.flac')
$ext = [System.IO.Path]::GetExtension($InputPath).ToLower()
$stem = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
$audioPath = $InputPath

if ($audioExts -notcontains $ext) {
  $audioPath = Join-Path $intDir ($stem + '.wav')
  # 16 kHz mono wav is ideal for Whisper.
  & $ffmpeg -hide_banner -loglevel error -y -i $InputPath -vn -ac 1 -ar 16000 $audioPath
  if (-not (Test-Path $audioPath)) { Write-Error "ffmpeg failed to extract audio"; exit 1 }
}

# Voicebox decodes only Whisper's first 30-second window per request, and reports the FULL duration
# while doing so, so a whole recording silently transcribes to just its opening 30 seconds with no error.
# Verified 2026-07-15: a 60s and a 300s clip from the same offset returned byte-identical text.
# Split into 30s chunks; the prompt transcribes each in order and concatenates.
$chunkDir = Join-Path $intDir ($stem + '-chunks')
if (Test-Path $chunkDir) { Remove-Item $chunkDir -Recurse -Force }
New-Item -ItemType Directory $chunkDir | Out-Null
& $ffmpeg -hide_banner -loglevel error -y -i $audioPath -f segment -segment_time 30 -ac 1 -ar 16000 (Join-Path $chunkDir 'c-%03d.wav')
$chunkCount = (Get-ChildItem $chunkDir -Filter 'c-*.wav').Count
if ($chunkCount -eq 0) { Write-Error "ffmpeg produced no chunks from $audioPath"; exit 1 }
"split into $chunkCount x 30s chunks -> $chunkDir"

# Feed the base prompt + the (ASCII) chunk dir marker to a single headless claude run.
$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'interview-digest-prompt.md')
$prompt = $prompt + "`n`nCHUNK_DIR=" + $chunkDir + "`nCHUNK_COUNT=" + $chunkCount + "`nSOURCE_FILE=" + $InputPath + "`n"

# PowerShell 5.1 wraps a native exe's stderr lines in NativeCommandError, which $ErrorActionPreference='Stop'
# turns fatal. claude writes a harmless "no stdin data received" warning to stderr, so relax EAP for this call
# and judge success by the completion marker below instead.
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
claude -p $prompt `
  --allowedTools 'Read' 'Write' 'Edit' 'Glob' 'PowerShell' `
    'mcp__voicebox__voicebox_transcribe' `
  *> $logFile
$ErrorActionPreference = $prevEAP

$ok = (Test-Path $logFile) -and ((Get-Content -Raw $logFile) -match '===\s*interview-digest\s*完了\s*===')
if ($ok) {
  "interview-digest OK. notes appended to chrome-prompts/interview-notes.local.md (log: logs/$(Split-Path $logFile -Leaf))"

  # 活動ログに「何を/何のために/どうしたか」を1行残す(本人が後から確認できる状態のため)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') `
    -By 'interview-digest' -Action ("面接の議事録を作成: " + $stem) `
    -Why '録画を後から振り返り、次選考対策・志望動機に反映するため' `
    -How '録音をvoiceboxで文字起こし→議事録化(要確認箇所はタイムスタンプ付きで明示)' `
    -Link 'chrome-prompts/interview-notes.local.md' -Result '成功' | Out-Null

  # --- 掃除(本人方針 2026-07-16): 議事録が取れたら中間ファイルとデカい元録画を消す。 ------------
  # 「議事録取れたら消していい」。ただし議事録は不明瞭箇所を [mm:ss] で聞き直す設計なので、
  # 聞き直し用の 16kHz mono wav($audioPath)と文字起こし txt は必ず残す。消すのは:
  #   ・30秒チャンク($chunkDir、純粋な中間・数百MB)
  #   ・元動画($InputPath が mp4 等で、そこから wav を抽出した場合のみ。数GB)。-KeepSource で残せる。
  # 入力が最初から wav(record-audio.ps1 の出力)なら、それ自体が聞き直し用なので消さない。
  if (Test-Path $chunkDir) {
    Remove-Item $chunkDir -Recurse -Force -ErrorAction SilentlyContinue
    "  cleanup: 中間チャンクを削除 ($chunkDir)"
  }
  $extractedFromVideo = ($audioPath -ne $InputPath)   # 動画等から wav を別途抽出した場合に true
  if ($extractedFromVideo -and -not $KeepSource -and (Test-Path $InputPath)) {
    $mb = [math]::Round((Get-Item $InputPath).Length / 1MB, 0)
    Remove-Item $InputPath -Force -ErrorAction SilentlyContinue
    "  cleanup: 元録画を削除 (${mb}MB, 聞き直し用wavは保持 -> $audioPath)"
  }
} else {
  # Exit non-zero so a background/scheduled caller sees the failure. Returning 0 here made a failed run
  # look like a completed one (2026-07-16).
  Write-Warning "interview-digest FAILED (no completion marker). See log: logs/$(Split-Path $logFile -Leaf)"
  exit 1
}
