# log-motivation: 就活のモチベーション(1-10)と一言を1行残す。
#
# 背景(2026-08-10 本人「就活疲れてきた。こういうモチベーショングラフも残しておこう」):
#   疲れ・浮き沈みも記録に残し、何がモチベを削り/回復させるかを後から確認できるようにする。
#   書き手はagent(会話でモチベに触れたら記録)または本人。閲覧は scripts/motivation-report.ps1。
#
# 使い方:
#   powershell -File scripts/log-motivation.ps1 -Score 4 -Note "就活疲れてきた" -Event "バクラクハッカソン後"
#   Score省略可(発言だけ残したいとき)。
param(
  [int]$Score = 0,                                 # 1-10。0=未評価(発言のみ記録)
  [Parameter(Mandatory = $true)][string]$Note,     # 本人の言葉・状況の一言
  [string]$Event = '',                             # きっかけ(面接/結果/ハッカソン等。任意)
  [string]$By = 'session'
)

if ($Score -lt 0 -or $Score -gt 10) { throw "Score は 1-10(未評価は省略)で指定してください" }

$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir 'motivation-log.jsonl'

$entry = [ordered]@{
  ts    = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')
  by    = $By
  score = if ($Score -ge 1) { $Score } else { $null }
  note  = $Note
  event = $Event
}
$line = ($entry | ConvertTo-Json -Compress -Depth 3)

$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::AppendAllText($logFile, $line + "`n", $utf8)
if ($Score -ge 1) { "logged motivation $Score/10: $Note" } else { "logged motivation (score未評価): $Note" }
