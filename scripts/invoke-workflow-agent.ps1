param(
  [Parameter(Mandatory = $true)][string]$Contract,
  [Parameter(Mandatory = $true)][string]$RunId,
  [Parameter(Mandatory = $true)][string]$Step,
  [Parameter(Mandatory = $true)][string]$PromptFile,
  [Parameter(Mandatory = $true)][string]$OutputFile,
  [ValidateSet('auto', 'codex', 'claude', 'codex-oss')][string]$Agent = 'auto',
  [string]$Store = ''
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $repo 'sync'
. (Join-Path $PSScriptRoot 'tsx-command.ps1')
$tsxLaunch = Get-KatazukuTsxCommand -SyncDirectory $sync
$tsxCommand = $tsxLaunch.Command
$tsxPrefix = $tsxLaunch.Prefix
$contractPath = if ([IO.Path]::IsPathRooted($Contract)) { [IO.Path]::GetFullPath($Contract) } else { [IO.Path]::GetFullPath((Join-Path $repo $Contract)) }
$promptPath = if ([IO.Path]::IsPathRooted($PromptFile)) { [IO.Path]::GetFullPath($PromptFile) } else { [IO.Path]::GetFullPath((Join-Path $repo $PromptFile)) }
$outputPath = if ([IO.Path]::IsPathRooted($OutputFile)) { [IO.Path]::GetFullPath($OutputFile) } else { [IO.Path]::GetFullPath((Join-Path $repo $OutputFile)) }
$storeArgs = @()
if ($Store) { $storeArgs = @('--store', $Store) }
function Invoke-Control([string[]]$Arguments) {
  Push-Location $sync
  try {
    $result = & $tsxCommand @tsxPrefix scripts/workflow-control.ts @Arguments
    $exitCode = $LASTEXITCODE
  } finally { Pop-Location }
  if ($exitCode -ne 0) { throw "workflow制御に失敗しました: $($Arguments -join ' ')" }
  return $result
}

$configText = Invoke-Control @('step-config', '--contract', $contractPath, '--step', $Step)
$config = $configText | ConvertFrom-Json
if ($config.owner -ne 'agent') { throw "Agent以外のstepはこのwrapperで実行できません: $Step owner=$($config.owner)" }

Invoke-Control (@('begin', '--contract', $contractPath, '--run-id', $RunId, '--step', $Step, '--owner', 'agent') + $storeArgs) | Out-Null
try {
  & (Join-Path $PSScriptRoot 'invoke-agent.ps1') -Workflow $config.workflowId -RunId $RunId `
    -PromptFile $promptPath -Risk $config.risk -SideEffectMode $config.sideEffectMode -Agent $Agent `
    -Capability @($config.capabilities) -OutputSchema $config.outputSchema -OutputFile $outputPath
  Invoke-Control (@('complete', '--contract', $contractPath, '--run-id', $RunId, '--step', $Step,
    '--owner', 'agent', '--output', $outputPath) + $storeArgs) | Out-Null
} catch {
  $message = $_.Exception.Message
  try {
    Invoke-Control (@('fail', '--contract', $contractPath, '--run-id', $RunId, '--step', $Step,
      '--owner', 'agent', '--status', 'unknown', '--error', $message) + $storeArgs) | Out-Null
  } catch {}
  throw
}
