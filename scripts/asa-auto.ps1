# katazuku asa — 無人・メール配信版(タスクスケジューラから run-asa.vbs 経由で無音起動する)
# 対話ターミナルを出さず、asa ルーチンを共通runnerで実行し、
# 「きょうやること」サマリを本人のGmailに送って終わる。失敗は alert-asa.txt に残し、次のasa/朝の報告で拾う。
# 手動で会話したいときは従来どおり `katazuku asa`(対話版)を使う。
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("asa-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

$base = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'asa-prompt.md')

# 対話版ルーチンに「無人・メール配信」の締めを追記する(asa-prompt.md 自体は対話版のまま触らない)
$mailTo = 'okuyama.kotaro.career@gmail.com'
$tail = @"

---
【自動実行(メール配信)モード / 無人・対話なし】
- このセッションは対話できない。最後に「送っていい/直す?」等の問いかけで終わらせない。判断が要るものも下書き作成・カレンダー登録まで済ませ、本人がやる分は下のメール本文にそのまま書く。
- 全処理が終わったら、出力した「きょうやること / 自動で済ませたこと / きょうはやらなくていい / ノイズ」のサマリ全文を、件名『きょうやること (M/D 曜)』で mcp__google-workspace__send_gmail_message を使って $mailTo 宛に送る(to=$mailTo, body_format=plain, 本文はプレーンテキスト、絵文字禁止)。曜日はJSTで機械確認して書く。
- **送信ツールはこの"自分宛サマリ"の送信だけに使う**。企業・採用担当への返信/下書きの送信には絶対に使わない(相手宛は下書き作成までに留める)。
- メール送信に成功したら、出力の最終行に他の文字を付けず単独で半角ASCIIで `=== asa DONE ===` と出力する(この行の有無で正常完了を判定する。日本語を混ぜない)。
"@
$prompt = $base + $tail

# headless実行。asa が使う一式(メール読取・下書き・ラベル・カレンダー・ドライブ/シート読取・自分宛送信)を許可。
# プロンプトは stdin 経由(本文のハイフン語/ダブルクオートが引数誤解釈される事故を避ける。daily-sync と同方針)。
$invoke = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$runId = 'asa:' + (Get-Date -Format 'yyyy-MM-dd')
try {
  & $invoke -Workflow 'asa' -RunId $runId -PromptText $prompt `
    -Risk 'external-commit' -SideEffectMode 'reconcile' `
    -Capability @('workspace.read', 'workspace.write', 'shell', 'gmail.read', 'gmail.draft', 'gmail.labels', 'gmail.send.self', 'calendar.read', 'calendar.write', 'drive.read', 'sheets.read') `
    *>&1 | Out-File -FilePath $logFile -Encoding utf8
} catch {
  $_ | Out-File -FilePath $logFile -Append -Encoding utf8
}

# 完了センチネル方式で正常判定(daily-sync と同じ。ASCIIの `=== asa DONE ===` の有無だけで見る)
# 判定材料は $logFile だけに頼らない。agent-runner の stdout はラッパー側で途中までしか
# 拾えないことがあり(2026-07-30/07-31 に実害: メールは届いているのに「失敗」と誤報し、
# 翌朝の「自動化の故障」に嘘が載った)、モデルの最終出力の正は
# logs/agent-runs/<runId>/*-output.local.txt。両方を見て、どちらかに完了行があれば成功とする。
$alertFile = Join-Path $logDir 'alert-asa.txt'
. (Join-Path $PSScriptRoot 'agent-sentinel.ps1')
$done = Test-AgentSentinel -Sentinel '===\s*asa\s*DONE\s*===' -LogDir $logDir -RunId $runId -LogFile $logFile
$logSize = if (Test-Path $logFile) { (Get-Item $logFile).Length } else { 0 }
$failReason = $null
if ($done) {
  # 成功。何もしない(下で alert を消す)
} elseif ($logSize -lt 200) {
  $failReason = 'ログが空か極小(agent実行自体が失敗した可能性)'
} else {
  $failReason = '完了行なし(メール送信まで到達しなかった=きょうやることが届いていない可能性)'
}
if ($failReason) {
  ("{0} asa 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $failReason, (Split-Path $logFile -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
} elseif (Test-Path $alertFile) {
  Remove-Item $alertFile -Force
}

# 30日より古いログは消す
Get-ChildItem $logDir -Filter 'asa-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
