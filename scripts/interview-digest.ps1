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
  [string]$InputPath
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
} else {
  Write-Warning "interview-digest may have failed (no completion marker). See log: logs/$(Split-Path $logFile -Leaf)"
}
