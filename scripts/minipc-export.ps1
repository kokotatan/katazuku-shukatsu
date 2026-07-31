# minipc-export: ノートPC → MiniPC へ渡す「gitに載せられない実体」を1つのフォルダへ集める。
#
# gitには入らないがMiniPCには必要なもの:
#   data/katazuku.db(正本) / .env(秘密) / OAuthトークン / 活動ログ / 人物写真 / *.local.md
#
# 使い方(ノートPCで実行):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\minipc-export.ps1 -Out D:\katazuku-transfer
#
# できたフォルダは丸ごと秘密。USBメモリかLANの共有で運ぶ。
# クラウドへ置くときも共有リンクは作らないこと。
param(
  [Parameter(Mandatory = $true)][string]$Out
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path $Out)) { New-Item -ItemType Directory -Path $Out -Force | Out-Null }
$Out = (Resolve-Path $Out).Path

function Copy-If($src, $dstName) {
  if (Test-Path $src) {
    Copy-Item $src (Join-Path $Out $dstName) -Recurse -Force
    Write-Output "  OK  $dstName"
  } else {
    Write-Output "  --  $dstName (無いのでスキップ)"
  }
}

Write-Output "MiniPCへ渡す一式を $Out に作ります"

# 1. 正本DBとスナップショット
Copy-If (Join-Path $repo 'data\katazuku.db') 'katazuku.db'
Copy-If (Join-Path $repo 'data\snapshot.json') 'snapshot.json'

# 2. 秘密情報(.env)
Copy-If (Join-Path $repo '.env') 'dotenv.txt'

# 3. google-workspace MCP の OAuth トークン(Gmail/Calendar/Driveの認証)
Copy-If (Join-Path $env:USERPROFILE '.google_workspace_mcp\credentials') 'google_workspace_mcp_credentials'

# 4. ローカル資格情報ブローカー(マイページのID/PW)
Copy-If (Join-Path $repo 'credential-store') 'credential-store'

# 5. 活動ログ(番犬が「動いているか」を判断する材料。連続性のため引き継ぐ)
Copy-If (Join-Path $repo 'logs\activity-log.jsonl') 'activity-log.jsonl'

# 6. 人物写真(DBにはstorage_keyしか入らないため実体が要る)
Copy-If (Join-Path $repo 'data\private\photos') 'photos'

# 7. 個人データを含むローカル台帳
Get-ChildItem (Join-Path $repo 'chrome-prompts') -Filter '*.local.md' -ErrorAction SilentlyContinue | ForEach-Object {
  Copy-Item $_.FullName (Join-Path $Out $_.Name) -Force
  Write-Output "  OK  $($_.Name)"
}

@'
このフォルダには個人情報・秘密情報が入っています。
- 共有リンクを作らない。公開ストレージへ置かない
- MiniPCへ移したら、この転送用フォルダは削除する
- credential-store は DPAPI で「その利用者・その端末」に紐付くため、MiniPCでは
  復号できない可能性が高い。その場合はMiniPC側で register-credentials.bat から入れ直す
'@ | Out-File (Join-Path $Out '_READ_ME_FIRST.txt') -Encoding utf8

Write-Output ''
Write-Output '完了。次はMiniPC側で:'
Write-Output '  1. このフォルダをMiniPCへ運ぶ'
Write-Output '  2. git clone でリポジトリを取得'
Write-Output '  3. powershell -NoProfile -ExecutionPolicy Bypass -File scripts\minipc-bootstrap.ps1 -From <運んだフォルダ>'
Write-Output ''
Write-Output '注意: DBのコピー中に定常タスクが書き込むと不整合が起きます。先に次で止めてください:'
Write-Output "  Get-ScheduledTask -TaskName 'katazuku-*' | Disable-ScheduledTask"
