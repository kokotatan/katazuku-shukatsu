# 定期処理の入口と出口で同じ正本DBを再評価する。ここではLLMも外部送信も起動しない。
function Update-KatazukuMeetingPreparation {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot, [switch]$RequireReady)
  $ErrorActionPreference = 'Stop'
  $logDirectory = Join-Path $RepositoryRoot 'logs'
  if (-not (Test-Path -LiteralPath $logDirectory)) { New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null }
  $alertPath = Join-Path $logDirectory 'alert-meeting-preparation.txt'
  try {
    . (Join-Path $RepositoryRoot 'scripts\katazuku-role.ps1')
    if ((Get-KatazukuOperationalRole -RepositoryRoot $RepositoryRoot) -ne 'canonical') { throw '正本DBを利用できません' }
    . (Join-Path $RepositoryRoot 'scripts\tsx-command.ps1')
    $runtime = Get-KatazukuTsxCommand -SyncDirectory (Join-Path $RepositoryRoot 'sync')
    $command = $runtime.Command
    $prefix = $runtime.Prefix
    $mode = if ($RequireReady) { 'check' } else { 'list' }
    & $command @prefix (Join-Path $RepositoryRoot 'sync\scripts\meeting-preparation.ts') $mode `
      --write (Join-Path $logDirectory 'meeting-preparation.local.json') --alert $alertPath | Out-Null
    if ($LASTEXITCODE -ne 0) { return $false }
    return $true
  } catch {
    ("面談準備の検査が失敗: {0}" -f $_.Exception.Message) | Out-File -LiteralPath $alertPath -Encoding utf8
    return $false
  }
}
