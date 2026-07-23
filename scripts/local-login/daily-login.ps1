# 毎日ログインのオーケストレータ。run-local-login.vbs から隠しウィンドウで呼ばれる。
# portals.json の各ポータルについて node ランナーを回す。資格情報レコードが無いポータルは
# ランナー側で skipped として安全に飛ばす。秘密値はこのスクリプトも一切扱わない。
# ログはランナーが logs/local-login-YYYY-MM-DD.log に status/reason/portal/origin だけ残す。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$runner = Join-Path $scriptDir 'daily-login.mjs'
$registryPath = Join-Path $scriptDir 'portals.json'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node が見つかりません(PATHを確認してください)。' }

$registry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$portalIds = $registry.portals.PSObject.Properties.Name

foreach ($portalId in $portalIds) {
  # ランナーは自前でログ出力し、成否をJSON1行でstdoutへ返す。ここでは値を解釈しない。
  & $node $runner '--portal' $portalId | Out-Null
}

"local-login: $($portalIds.Count) ポータルを処理しました(詳細は logs/local-login-*.log)。"
