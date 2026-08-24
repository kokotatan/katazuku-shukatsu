# katazuku 毎朝の選考同期(Phase B / spec14「副作用の分離」版)
#
# 従来の daily-sync.ps1 は「モデルが抽出もDB書き込みもミラーも全部やる」モデル直接apply型。
# この v2 は spec14 のとおり2段に割る:
#   1) 抽出フェーズ(read-only): agentがGmailを読み、schema準拠の厳格JSONを1つ返すだけ。副作用なし。
#      必要capabilityは gmail.read。Gmail接続を持たないprovider(Codex/OSS)は候補から自動で外れる。
#   2) 決定論的apply: daily-sync-apply.ts が JSON Schema 検証 → 既存 db-apply-* で反映。
#      モデルにSQL・DB書き込みを委ねない。どのproviderが抽出しても同じ検証・遷移規則・冪等化が効く。
#
# Gmailの既読化・ゴミ箱整理・シートミラーは副作用(external)であり、この v2 には含めない。
# それらは従来 daily-sync.ps1 側に残す(Phase B.2 で別executorへ分離予定)。
param(
  [ValidateSet('auto', 'codex', 'claude', 'codex-oss')][string]$Agent = 'auto',
  [switch]$Force
)
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$sync = Join-Path $repo 'sync'
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$ts = Get-Date -Format 'yyyy-MM-dd_HHmmss'
$logFile = Join-Path $logDir ("daily-sync-v2-{0}.log" -f $ts)
$extractJson = Join-Path $logDir ("daily-sync-extract-{0}.local.json" -f $ts)
$alertFile = Join-Path $logDir 'alert-daily-sync.txt'
$promptFile = Join-Path $PSScriptRoot 'daily-sync-extract-prompt.md'
$runId = "daily-sync:$ts"
$workflowContract = Join-Path $sync 'workflows\daily-sync.json'
$npx = if ($IsWindows -or $env:OS -eq 'Windows_NT') { 'npx.cmd' } else { 'npx' }

function Write-Log([string]$msg) { $msg | Out-File -FilePath $logFile -Append -Encoding utf8 }
function Set-Alert([string]$reason) {
  ("{0} daily-sync(v2) 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $reason, (Split-Path $logFile -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
}
function Invoke-WorkflowControl([string[]]$Arguments) {
  Push-Location $sync
  try {
    & $npx tsx scripts/workflow-control.ts @Arguments --contract $workflowContract --run-id $runId *>&1 |
      Tee-Object -FilePath $logFile -Append | Out-Null
    $controlExit = $LASTEXITCODE
  } finally { Pop-Location }
  if ($controlExit -ne 0) { throw "workflow制御に失敗しました: $($Arguments -join ' ')" }
}
function Start-ExecutorStep([string]$Step) {
  Invoke-WorkflowControl @('begin', '--step', $Step, '--owner', 'executor')
}
function Complete-ExecutorStep([string]$Step, [string]$Output = '') {
  $args = @('complete', '--step', $Step, '--owner', 'executor')
  if ($Output) { $args += @('--output', $Output) }
  Invoke-WorkflowControl $args
}
function Fail-ExecutorStep([string]$Step, [string]$Reason) {
  try {
    Invoke-WorkflowControl @('fail', '--step', $Step, '--owner', 'executor', '--status', 'unknown', '--error', $Reason)
  } catch {}
}

Write-Log ("===== {0} daily-sync(v2) 開始 =====" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'))

# workflow契約で正本DB、工程順、ownerを固定する。実行台帳はlogs内のlocal DBへ置く。
Invoke-WorkflowControl @('start')
Start-ExecutorStep 'prepare'
Complete-ExecutorStep 'prepare'

# --- 1) 抽出フェーズ(read-only・厳格JSON・schema検証つき) ---
try {
  & (Join-Path $PSScriptRoot 'invoke-workflow-agent.ps1') `
    -Contract $workflowContract -RunId $runId -Step 'extract' -PromptFile $promptFile `
    -OutputFile $extractJson -Agent $Agent *>&1 |
    Tee-Object -FilePath $logFile -Append | Out-Null
} catch {
  Set-Alert ("抽出フェーズ失敗: " + $_.Exception.Message)
  Write-Error "daily-sync(v2) 抽出フェーズに失敗しました。詳細: $logFile"
  exit 1
}
if (-not (Test-Path $extractJson)) {
  Set-Alert '抽出JSONが生成されませんでした(Gmail不通・schema不一致・provider全滅の可能性)'
  Write-Error "daily-sync(v2) 抽出JSONがありません。詳細: $logFile"
  exit 1
}

# --- 2) Schema/業務規則を独立工程で検証する ---
try {
  Start-ExecutorStep 'validate'
  Push-Location $sync
  try {
    & $npx tsx scripts/daily-sync-apply.ts $extractJson --validate-only *>&1 |
      Tee-Object -FilePath $logFile -Append | Out-Null
    $validateExit = $LASTEXITCODE
  } finally { Pop-Location }
  if ($validateExit -ne 0) { throw "schema/業務規則の検証に失敗しました: exit=$validateExit" }
  Complete-ExecutorStep 'validate' $extractJson
} catch {
  Fail-ExecutorStep 'validate' $_.Exception.Message
  Set-Alert $_.Exception.Message
  Write-Error "daily-sync(v2) 検証に失敗しました。詳細: $logFile"
  exit 1
}

# --- 3) 決定論的apply(schema検証 → 既存 db-apply-* を1接続で束ねる) ---
$applyArgs = @('tsx', 'scripts/daily-sync-apply.ts', $extractJson)
if ($Force) { $applyArgs += '--force' }
Start-ExecutorStep 'apply'
Push-Location $sync
try {
  & $npx @applyArgs *>&1 | Tee-Object -FilePath $logFile -Append
  $applyExit = $LASTEXITCODE
} finally { Pop-Location }
if ($applyExit -ne 0) {
  Fail-ExecutorStep 'apply' "決定論的applyに失敗(exit=$applyExit)"
  Set-Alert "決定論的applyに失敗(exit=$applyExit)"
  Write-Error "daily-sync(v2) applyに失敗しました。詳細: $logFile"
  exit 1
}
Complete-ExecutorStep 'apply'

# --- 4) スナップショット(アプリ即時反映+日次バックアップ) ---
Start-ExecutorStep 'snapshot'
Push-Location $sync
try {
  & $npx tsx scripts/db-snapshot.ts *>&1 | Tee-Object -FilePath $logFile -Append
  $snapshotExit = $LASTEXITCODE
} finally { Pop-Location }
if ($snapshotExit -ne 0) {
  Fail-ExecutorStep 'snapshot' "snapshotに失敗(exit=$snapshotExit)"
  Set-Alert "snapshotに失敗(exit=$snapshotExit)"
  Write-Error "daily-sync(v2) snapshotに失敗しました。詳細: $logFile"
  exit 1
}
Complete-ExecutorStep 'snapshot'

# --- 5) 活動ログ ---
Start-ExecutorStep 'audit'
& (Join-Path $PSScriptRoot 'log-activity.ps1') -By 'daily-sync-v2' `
  -Action '毎朝の選考同期(抽出/決定論apply分離版)' `
  -Why 'モデルにDB書込を委ねず、schema検証済みの抽出結果だけを既存db-applyで反映するため' `
  -How ("run=$runId / 抽出JSON=" + (Split-Path $extractJson -Leaf)) `
  -Link '選考管理シート(ミラー)' -Result '成功' 2>&1 | Out-Null
Complete-ExecutorStep 'audit'

if (Test-Path $alertFile) { Remove-Item $alertFile -Force }
Write-Log "=== daily-sync DONE ==="
Write-Output "=== daily-sync DONE ==="

# 30日より古い v2 ログ・抽出JSONは掃除する
Get-ChildItem $logDir -Filter 'daily-sync-v2-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
Get-ChildItem $logDir -Filter 'daily-sync-extract-*.local.json' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
