# 共通工程CLIの起動方法を解決する。呼出元で & を使い、LASTEXITCODEを直接確認する。
function Get-KatazukuTsxCommand {
  param([Parameter(Mandatory = $true)][string]$SyncDirectory)
  $nodeCommand = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  $tsxPath = Join-Path $SyncDirectory 'node_modules/tsx/dist/cli.mjs'
  if ($nodeCommand -and (Test-Path -LiteralPath $tsxPath)) {
    return @{ Command = $nodeCommand.Source; Prefix = @($tsxPath) }
  }
  $npxCommand = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }
  return @{ Command = $npxCommand; Prefix = @('tsx') }
}
