# mobility: 場所・移動設定をDBへ反映し、snapshotと活動ログを更新する。
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('place', 'profile', 'appointment', 'route', 'segment', 'list')]
  [string]$Action,
  [string]$InputJson = ''
)

$repo = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $repo 'sync'
$arguments = @('tsx', 'scripts/db-mobility.ts', $Action)
if ($Action -ne 'list') {
  if (-not $InputJson) { throw "$Action には -InputJson が必要です" }
  $arguments += (Resolve-Path $InputJson).Path
}

Push-Location $sync
try {
  & npx @arguments
  if ($LASTEXITCODE -ne 0) { throw "db-mobility が終了コード $LASTEXITCODE で失敗しました" }
  if ($Action -ne 'list') {
    & npx tsx scripts/db-snapshot.ts
    if ($LASTEXITCODE -ne 0) { throw "db-snapshot が終了コード $LASTEXITCODE で失敗しました" }
  }
} finally {
  Pop-Location
}

if ($Action -ne 'list') {
  $logParams = @{
    By = 'mobility'
    Action = "移動データの$ActionをDBへ反映"
    Why = '空き時間だけでなく移動を含めて参加可能な日程を判断するため'
    How = '場所・参加形態・経路見積もり・移動区間の専用CLIで反映しsnapshotを更新'
    Link = $InputJson
    Result = '成功'
  }
  & (Join-Path $PSScriptRoot 'log-activity.ps1') @logParams
}
