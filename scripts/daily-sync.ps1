# katazuku 毎日のシート同期 (Windowsタスクスケジューラから起動する)
# 登録方法は docs/MINIPC-SETUP.md を参照
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("sync-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

$prompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'daily-sync-prompt.md')

# headless実行。ツールは同期に必要な最小限だけ許可する
# Gmail MCP は自前 google-workspace 系と claude.ai 直結コネクタ(mcp__claude_ai_*)の両対応
# プロンプトは -p の引数ではなく stdin 経由で渡す。本文に含まれる `-Why "..."` 等の
# ハイフン語+ダブルクオートを PowerShell が引数分割し、providerが `-Why` を未知オプションと
# 誤認して起動失敗する事故が 2026-07-18 に発生したため(引数渡しはこの化けに弱い)。
$invoke = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$runId = 'daily-sync-legacy:' + (Get-Date -Format 'yyyy-MM-dd')
try {
  & $invoke -Workflow 'daily-sync-legacy' -RunId $runId `
    -PromptFile (Join-Path $PSScriptRoot 'daily-sync-prompt.md') `
    -Risk 'external-commit' -SideEffectMode 'reconcile' `
    -Capability @('workspace.read', 'workspace.write', 'shell', 'gmail.read', 'gmail.labels', 'gmail.send.self', 'sheets.read', 'sheets.write') `
    *>&1 | Out-File -FilePath $logFile -Encoding utf8
} catch {
  $_ | Out-File -FilePath $logFile -Append -Encoding utf8
}

# 実行結果を検査し、失敗の疑いがあれば alert ファイルに残す(asa が翌朝【自動化の故障】として報告する)
# 正常判定は完了センチネル方式: プロンプトが最後に出力する『=== daily-sync DONE ===』の有無だけで判定する。
# センチネルは半角ASCIIにする(日本語「完了」はログの文字コード次第で化け、正常なのに失敗と誤報するため。
# 実際 2026-07-15/16 は処理成功なのに「完了」が化けて誤報していた)。旧ログ互換で「完了」も許容する。
# 鍵不在によるシート同期スキップは「正常完了(部分)」であり、完了行が出るので故障扱いしない。
$alertFile = Join-Path $logDir 'alert-daily-sync.txt'
. (Join-Path $PSScriptRoot 'agent-sentinel.ps1')
$done = Test-AgentSentinel -Sentinel '===\s*daily-sync\s*(DONE|完了)\s*===' -LogDir $logDir -RunId $runId -LogFile $logFile
$failReason = $null
if ($done) {
  # 正常完了
} elseif (-not (Test-Path $logFile) -or (Get-Item $logFile).Length -lt 200) {
  $failReason = 'ログが空か極小(agent実行自体が失敗した可能性)'
} else {
  $failReason = '完了行なし(Gmail不通・認証エラー・途中終了などで最後まで到達しなかった可能性)'
}
if ($failReason) {
  ("{0} daily-sync 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $failReason, (Split-Path $logFile -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
} elseif (Test-Path $alertFile) {
  # 正常に戻ったら故障アラートは消す
  Remove-Item $alertFile -Force
}

# 30日より古いログは消す
Get-ChildItem $logDir -Filter 'sync-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
