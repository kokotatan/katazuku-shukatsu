# 自動運転ジョブの「正常完了」判定を1か所に集約する。
#
# 各ラッパー(asa-auto / calendar-sync / daily-sync / evening-brief / research-company)は
# プロンプト末尾にASCIIの完了行(例 `=== asa DONE ===`)を出させ、その有無で成否を決めている。
# ところが判定材料をラッパー側のログ($logFile)だけに置いていたため、agent-runner の stdout を
# 最後まで拾えなかった回に「実際は成功しているのに失敗」と誤報していた。
# 2026-07-30/07-31 の asa で実害(メールは届いているのに alert-asa.txt が残り、翌朝の
# 「自動化の故障」に嘘が載った)。
#
# モデル最終出力の正は logs/agent-runs/<runId>/ 配下の成果物(agent-runtime.ts が書く)。
# ファイル名は provider で異なる: claude 系は *-output.local.txt、codex 系は *-final.local.txt。
# 片方だけを見ると、フォールバックで codex が担当した回を取りこぼす(7/30 の asa が実際にこれ)。
# ラッパーログと両方の成果物を見て、どれかに完了行があれば成功とする。

# agent-runtime.ts の safeSegment() と同じ正規化。runId から成果物ディレクトリ名を作る。
function Get-AgentRunDirName {
  param([Parameter(Mandatory = $true)][string]$RunId)
  ($RunId -replace '[^a-zA-Z0-9._-]+', '-') -replace '^-+|-+$', ''
}

# 完了行が見つかれば $true。$LogFile と成果物の両方を見る。
function Test-AgentSentinel {
  param(
    [Parameter(Mandatory = $true)][string]$Sentinel,  # 正規表現
    [Parameter(Mandatory = $true)][string]$LogDir,
    [Parameter(Mandatory = $true)][string]$RunId,
    [string]$LogFile = ''
  )
  if ($LogFile -and (Test-Path -LiteralPath $LogFile)) {
    if ((Get-Content -Raw -Encoding UTF8 -LiteralPath $LogFile) -match $Sentinel) { return $true }
  }
  $runDir = Join-Path $LogDir ('agent-runs\' + (Get-AgentRunDirName -RunId $RunId))
  if (Test-Path -LiteralPath $runDir) {
    $artifacts = @(Get-ChildItem -LiteralPath $runDir -ErrorAction SilentlyContinue |
      Where-Object { $_.Name -like '*-output.local.txt' -or $_.Name -like '*-final.local.txt' })
    foreach ($artifact in $artifacts) {
      if ((Get-Content -Raw -Encoding UTF8 -LiteralPath $artifact.FullName) -match $Sentinel) { return $true }
    }
  }
  return $false
}
