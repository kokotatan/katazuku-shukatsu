# log-activity: 自律処理が「何を・何のために・どうしたか」を1行残すための共通ヘルパー。
#
# 設計(2026-07-18 本人方針「全部自律 + 何を何のためにどうしたか確認できる状態」):
#   すべての自律ランナー(mail-watch / daily-sync / interview-digest / submit / record 等)は、
#   副作用のある操作をしたら必ずこのスクリプトを呼んで logs/activity-log.jsonl に1行追記する。
#   これが「確認できる状態」の唯一の書き込み先(SA鍵不要・認証不要・失敗しない追記のみ)。
#   人が見るときは scripts/activity-report.ps1、またはシートの「活動ログ」タブ(daily-syncが同期)。
#
# 使い方:
#   powershell -File scripts/log-activity.ps1 -By submit `
#     -Action "PKSHAアルゴリズム選考フォームを送信" `
#     -Why "臼﨑さんの書類選考案内(アルゴリズム職)に対応するため" `
#     -How "台帳から全11問を入力し送信。ビジネス職とは別窓口" `
#     -Link "https://docs.google.com/forms/..." -Result "成功"
param(
  [Parameter(Mandatory = $true)][string]$Action,   # 何を
  [Parameter(Mandatory = $true)][string]$Why,      # 何のために
  [string]$How = '',                               # どうした
  [string]$Link = '',                              # 確認先(ファイルパス/URL/シート行)
  [string]$By = 'session',                         # どのランナーがやったか
  [string]$Result = ''                             # 結果(成功/要確認/失敗 など。任意)
)

$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir 'activity-log.jsonl'

$entry = [ordered]@{
  ts     = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz')  # JSTのオフセット付きISO
  by     = $By
  action = $Action
  why    = $Why
  how    = $How
  link   = $Link
  result = $Result
}
$line = ($entry | ConvertTo-Json -Compress -Depth 4)

# BOM無しUTF-8で追記(JSONLの1行目にBOMが混ざらないように)。追記のみ=競合・破損に強い。
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::AppendAllText($logFile, $line + "`n", $utf8)
"logged [$By] $Action"
