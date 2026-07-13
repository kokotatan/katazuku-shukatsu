# interview-digest: transcribe an interview recording (via local voicebox Whisper),
# then structure it into chrome-prompts/interview-notes.local.md and generate forward-looking
# insights, all via a single headless `claude -p` run. Free / local / within Claude subscription.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\interview-digest.ps1 -AudioPath "C:\path\to\recording.wav"
#
# Supported audio: whatever voicebox's local Whisper accepts (wav/mp3/m4a). Long files (45min+) are fine.
param(
  [Parameter(Mandatory = $true)]
  [string]$AudioPath
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (-not (Test-Path $AudioPath)) { Write-Error "audio file not found: $AudioPath"; exit 1 }
$AudioPath = (Resolve-Path $AudioPath).Path

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$intDir = Join-Path $logDir 'interviews'
if (-not (Test-Path $intDir)) { New-Item -ItemType Directory $intDir | Out-Null }
$logFile = Join-Path $logDir ("interview-digest-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

# Build the prompt: base instructions + the audio path marker (ASCII so encoding is never an issue).
$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'interview-digest-prompt.md')
$prompt = $prompt + "`n`nAUDIO_PATH=" + $AudioPath + "`n"

claude -p $prompt `
  --allowedTools 'Read' 'Write' 'Edit' 'Glob' 'PowerShell' `
    'mcp__voicebox__voicebox_transcribe' `
  *> $logFile

# Success is signalled by the completion sentinel the prompt emits on a full run.
$ok = (Test-Path $logFile) -and ((Get-Content -Raw $logFile) -match '===\s*interview-digest\s*完了\s*===')
if ($ok) {
  "interview-digest OK. notes appended to chrome-prompts/interview-notes.local.md (log: logs/$(Split-Path $logFile -Leaf))"
} else {
  Write-Warning "interview-digest may have failed (no completion marker). See log: logs/$(Split-Path $logFile -Leaf)"
}
