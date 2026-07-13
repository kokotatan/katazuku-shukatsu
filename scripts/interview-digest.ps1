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

# voicebox accepts these audio formats directly; anything else (mp4/mkv/mov...) is extracted first.
$audioExts = @('.wav', '.mp3', '.m4a', '.webm', '.opus', '.flac')
$ext = [System.IO.Path]::GetExtension($InputPath).ToLower()
$audioPath = $InputPath

if ($audioExts -notcontains $ext) {
  # Locate ffmpeg (PATH may not be refreshed yet after a winget install, so also check the WinGet Links shim).
  $ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
  if (-not $ffmpeg) {
    $cand = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe") +
            (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | ForEach-Object FullName)
    $ffmpeg = $cand | Where-Object { Test-Path $_ } | Select-Object -First 1
  }
  if (-not $ffmpeg) { Write-Error "need ffmpeg to extract audio from '$ext'. Install: winget install Gyan.FFmpeg"; exit 1 }
  $audioPath = Join-Path $intDir ([System.IO.Path]::GetFileNameWithoutExtension($InputPath) + '.wav')
  # 16 kHz mono wav is ideal for Whisper.
  & $ffmpeg -hide_banner -loglevel error -y -i $InputPath -vn -ac 1 -ar 16000 $audioPath
  if (-not (Test-Path $audioPath)) { Write-Error "ffmpeg failed to extract audio"; exit 1 }
}

# Feed the base prompt + the (ASCII) audio path marker to a single headless claude run.
$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'interview-digest-prompt.md')
$prompt = $prompt + "`n`nAUDIO_PATH=" + $audioPath + "`n"

claude -p $prompt `
  --allowedTools 'Read' 'Write' 'Edit' 'Glob' 'PowerShell' `
    'mcp__voicebox__voicebox_transcribe' `
  *> $logFile

$ok = (Test-Path $logFile) -and ((Get-Content -Raw $logFile) -match '===\s*interview-digest\s*完了\s*===')
if ($ok) {
  "interview-digest OK. notes appended to chrome-prompts/interview-notes.local.md (log: logs/$(Split-Path $logFile -Leaf))"
} else {
  Write-Warning "interview-digest may have failed (no completion marker). See log: logs/$(Split-Path $logFile -Leaf)"
}
