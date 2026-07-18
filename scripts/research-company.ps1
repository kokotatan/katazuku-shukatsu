param(
  [Parameter(Mandatory = $true)][string]$Company,
  [string]$Position = '',
  [ValidateSet('auto', 'codex', 'claude')][string]$Agent = 'auto'
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$safe = $Company -replace '[\\/:*?"<>|]', '-'
$dbJson = Join-Path $repo ("sync\research-{0}-loop.json" -f $safe)
$logFile = Join-Path $logDir ("research-{0}-{1}.log" -f $safe, (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$prompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'company-research-prompt.md')
$prompt = $prompt + [Environment]::NewLine + "COMPANY=" + $Company + [Environment]::NewLine + "POSITION=" + $Position + [Environment]::NewLine + "DB_JSON=" + $dbJson
$runner = $Agent
if ($runner -eq 'auto') {
  if (Get-Command codex -ErrorAction SilentlyContinue) {
    $runner = 'codex'
  } elseif (Get-Command claude -ErrorAction SilentlyContinue) {
    $runner = 'claude'
  } else {
    Write-Error 'Codex CLIとClaude CLIが見つかりません。'
    exit 1
  }
}
if ($runner -eq 'codex') {
  $prompt | codex exec --search -s danger-full-access -C $repo - 2>&1 | Out-File -FilePath $logFile -Encoding utf8
} else {
  $prompt | claude -p --allowedTools 'WebSearch' 'WebFetch' 'PowerShell' 'Read' 'Write' 2>&1 | Out-File -FilePath $logFile -Encoding utf8
}
$ok = (Test-Path $logFile) -and ((Get-Content -Raw -Encoding UTF8 $logFile) -match '===\s*company-research\s*DONE\s*===')
if (-not $ok) { Write-Error "企業研究に失敗しました。詳細: $logFile"; exit 1 }
Write-Output "企業研究完了: $Company"
