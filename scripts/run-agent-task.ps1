param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateNotNullOrEmpty()][string]$TaskFile,
  [string]$RunId = '',
  [ValidateSet('auto', 'codex', 'claude', 'codex-oss')][string]$Agent = 'auto',
  [string]$OutputFile = '',
  [int]$TimeoutMs = 7200000,
  [switch]$NoWeb,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$invokeAgent = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$resolvedTask = (Resolve-Path -LiteralPath $TaskFile -ErrorAction Stop).Path

if (-not $RunId) {
  $taskText = Get-Content -Raw -Encoding UTF8 -LiteralPath $resolvedTask
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($taskText))).Replace('-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
  $name = [IO.Path]::GetFileNameWithoutExtension($resolvedTask)
  $safeName = ($name.Normalize([Text.NormalizationForm]::FormKC) -replace '[^a-zA-Z0-9._-]+', '-').Trim('-')
  if (-not $safeName) { $safeName = 'task' }
  $RunId = 'development:' + $safeName + ':' + $digest.Substring(0, 16)
}

if (-not $OutputFile) {
  $safeRunId = ($RunId -replace '[^a-zA-Z0-9._-]+', '-').Trim('-')
  $OutputFile = Join-Path $repo ('logs\agent-tasks\' + $safeRunId + '-result.local.md')
}

$capabilities = @('workspace.read', 'workspace.write', 'shell')
if (-not $NoWeb) { $capabilities += 'web.search' }

$params = @{
  Workflow = 'development-task'
  RunId = $RunId
  PromptFile = $resolvedTask
  Risk = 'db-write'
  SideEffectMode = 'workspace'
  Agent = $Agent
  Capability = $capabilities
  OutputFile = $OutputFile
  TimeoutMs = $TimeoutMs
  DryRun = $DryRun
}

Write-Output ('agent task: ' + $RunId)
Write-Output 'provider順: Claude -> Codex -> local OSS (利用枠・認証・capabilityに応じて自動切替)'
& $invokeAgent @params
Write-Output ('結果: ' + $OutputFile)
