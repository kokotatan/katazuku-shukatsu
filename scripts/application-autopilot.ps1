# application-autopilot: 応募runの開始・イベント反映・確認を行う薄いランナー。
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('start', 'event', 'list', 'assessments')]
  [string]$Action,
  [string]$InputJson = ''
)

$repo = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $repo 'sync'
$arguments = @('tsx', 'scripts/db-application.ts', $Action)
if ($Action -in @('start', 'event')) {
  if (-not $InputJson) { throw "$Action には -InputJson が必要です" }
  $arguments += (Resolve-Path $InputJson).Path
}

Push-Location $sync
try {
  & npx @arguments
  if ($LASTEXITCODE -ne 0) { throw "db-application が終了コード $LASTEXITCODE で失敗しました" }
  if ($Action -in @('start', 'event')) {
    & npx tsx scripts/db-snapshot.ts
    if ($LASTEXITCODE -ne 0) { throw "db-snapshot が終了コード $LASTEXITCODE で失敗しました" }
  }
} finally {
  Pop-Location
}

if ($Action -in @('start', 'event')) {
  $logParams = @{
    By = 'application-autopilot'
    Action = "応募自動運転の$ActionをDBへ反映"
    Why = '応募・提出・予定を根拠付きで一元管理するため'
    How = '承認ゲート付きCLIで反映し、アプリ向けスナップショットを更新'
    Link = $InputJson
    Result = '成功'
  }
  & (Join-Path $PSScriptRoot 'log-activity.ps1') @logParams
}
