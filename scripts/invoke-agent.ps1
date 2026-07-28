param(
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$Workflow,
  [Parameter(Mandatory = $true)][ValidateNotNullOrEmpty()][string]$RunId,
  [string]$PromptFile = '',
  [string]$PromptText = '',
  [ValidateSet('read-only', 'db-write', 'external-draft', 'external-commit')][string]$Risk = 'read-only',
  [ValidateSet('none', 'workspace', 'reconcile', 'direct')][string]$SideEffectMode = 'none',
  [ValidateSet('auto', 'codex', 'claude', 'codex-oss')][string]$Agent = 'auto',
  [string[]]$Capability = @('workspace.read'),
  [string]$OutputSchema = '',
  [string]$OutputFile = '',
  [int]$TimeoutMs = 1800000,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $repo 'sync'
$runner = Join-Path $sync 'scripts\agent-runner.ts'
$temporaryPrompt = $null
if ([string]::IsNullOrWhiteSpace($PromptFile) -eq [string]::IsNullOrWhiteSpace($PromptText)) {
  throw 'PromptFileとPromptTextのどちらか一方だけを指定してください。'
}
if ($PromptText) {
  $promptDir = Join-Path $repo 'logs\agent-prompts'
  if (-not (Test-Path $promptDir)) { New-Item -ItemType Directory -Path $promptDir | Out-Null }
  $temporaryPrompt = Join-Path $promptDir (([guid]::NewGuid().ToString('N')) + '.local.md')
  [IO.File]::WriteAllText($temporaryPrompt, $PromptText, (New-Object Text.UTF8Encoding($false)))
  $PromptFile = $temporaryPrompt
} elseif (-not (Test-Path -LiteralPath $PromptFile)) {
  throw ('agent promptが見つかりません: ' + $PromptFile)
}
if (-not (Test-Path -LiteralPath $runner)) {
  throw "agent runnerが見つかりません: $runner"
}

$argsList = @(
  'tsx',
  'scripts/agent-runner.ts',
  '--workflow', $Workflow,
  '--run-id', $RunId,
  '--prompt-file', $PromptFile,
  '--cwd', $repo,
  '--risk', $Risk,
  '--side-effect-mode', $SideEffectMode,
  '--timeout-ms', [string]$TimeoutMs
)
foreach ($item in $Capability) {
  if ($item) { $argsList += @('--capability', $item) }
}
if ($Agent -ne 'auto') { $argsList += @('--provider', $Agent) }
if ($OutputSchema) { $argsList += @('--output-schema', $OutputSchema) }
if ($OutputFile) { $argsList += @('--output-file', $OutputFile) }
if ($DryRun) { $argsList += '--dry-run' }

$npx = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
if (-not (Get-Command $npx -ErrorAction SilentlyContinue)) {
  throw "npxが見つかりません。Node.jsをセットアップしてください。"
}
$exitCode = -1
Push-Location $sync
try {
  & $npx @argsList
  $exitCode = $LASTEXITCODE
} finally {
  Pop-Location
  if ($temporaryPrompt -and (Test-Path -LiteralPath $temporaryPrompt)) {
    Remove-Item -LiteralPath $temporaryPrompt -Force
  }
}
if ($exitCode -ne 0) {
  if ($exitCode -eq 3) {
    throw "agent実行は副作用の有無を確認できないため停止しました。同じrunをcheckpointから再開してください: $RunId"
  }
  throw "agent実行に失敗しました: workflow=$Workflow run=$RunId exit=$exitCode"
}
