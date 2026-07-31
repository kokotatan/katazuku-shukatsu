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
  # runnerのsoft deadlineを過ぎても親が返らないときに、プロセスツリーごと強制終了するまでの猶予。
  # 2026-07-31: provider CLIがMCPコネクタの承認待ちで無限に固まり、PowerShellが返らず、
  # タスクが数時間Runningのまま → MultipleInstances=IgnoreNew で以降の定期実行が全部飛ぶ、
  # という「自動運転が静かに止まる」連鎖の実害があった(calendar-syncが07:33-13:29の6時間ブロック)。
  [int]$GraceMs = 120000,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
# google-workspace MCP(uvx workspace-mcp)の起動が既定30秒に収まらず接続失敗する事故があったため、
# 子プロセス(claude/codex)へ引き継ぐMCPタイムアウトを延ばす。ここが全ワークフロー共通の入口。
if (-not $env:MCP_TIMEOUT) { $env:MCP_TIMEOUT = '180000' }
if (-not $env:MCP_TOOL_TIMEOUT) { $env:MCP_TOOL_TIMEOUT = '180000' }
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
# runnerを子プロセスとして起動し、ハードデッドラインで「プロセスツリーごと」殺す。
# `& $npx` の直接呼び出しでは親が返るまで待ち続けるしかなく、provider CLIが固まると
# 呼び出し元(タスク)が永久にRunningのままになる。taskkill /T で孫(node/claude/codex)まで落とす。
$stdoutFile = [IO.Path]::GetTempFileName()
$stderrFile = [IO.Path]::GetTempFileName()
$exitCode = -1
$killed = $false
Push-Location $sync
try {
  $proc = Start-Process -FilePath $npx -ArgumentList $argsList -NoNewWindow -PassThru `
    -RedirectStandardOutput $stdoutFile -RedirectStandardError $stderrFile
  # Start-Process -PassThru が返す Process は ExitCode を保持しないことがある(実害 2026-07-31:
  # 成功したrunがexit空で失敗扱いになった)。ハンドルを開いておくとOSが終了情報を保持する。
  $handle = $proc.Handle
  $hardMs = $TimeoutMs + $GraceMs
  if (-not $proc.WaitForExit($hardMs)) {
    $killed = $true
    # /T = 子孫ごと、/F = 強制。これをしないと node や provider CLI が孤児として残り続ける。
    & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
    try { $proc.WaitForExit(15000) | Out-Null } catch {}
  }
  # 引数なしのWaitForExitで終了処理を確定させてからExitCodeを読む(引数ありだけでは未確定のことがある)
  try { $proc.WaitForExit() } catch {}
  try { $proc.Refresh() } catch {}
  try { $exitCode = [int]$proc.ExitCode } catch { $exitCode = -1 }
  if ($null -eq $exitCode) { $exitCode = -1 }
} finally {
  Pop-Location
  foreach ($f in @($stdoutFile, $stderrFile)) {
    if (Test-Path -LiteralPath $f) {
      Get-Content -LiteralPath $f -Encoding UTF8 -ErrorAction SilentlyContinue | Write-Output
      Remove-Item -LiteralPath $f -Force -ErrorAction SilentlyContinue
    }
  }
  if ($temporaryPrompt -and (Test-Path -LiteralPath $temporaryPrompt)) {
    Remove-Item -LiteralPath $temporaryPrompt -Force
  }
}
if ($killed) {
  throw "agent実行がハードデッドライン($([math]::Round(($TimeoutMs + $GraceMs)/1000))秒)を超えたためプロセスツリーごと強制終了しました: workflow=$Workflow run=$RunId"
}
if ($exitCode -ne 0) {
  if ($exitCode -eq 3) {
    throw "agent実行は副作用の有無を確認できないため停止しました。同じrunをcheckpointから再開してください: $RunId"
  }
  throw "agent実行に失敗しました: workflow=$Workflow run=$RunId exit=$exitCode"
}
