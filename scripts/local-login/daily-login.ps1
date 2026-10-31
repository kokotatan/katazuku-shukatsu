# 毎日ログインのオーケストレータ。run-local-login.vbs から隠しウィンドウで呼ばれる。
# GUIの設定で選択したポータルについて node ランナーを回す。資格情報レコードが無いポータルは
# ランナー側で skipped として安全に飛ばす。秘密値はこのスクリプトも一切扱わない。
# ログはランナーが logs/local-login-YYYY-MM-DD.log に status/reason/portal/origin だけ残す。
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$scriptDir = $PSScriptRoot
$repoRoot = Split-Path -Parent (Split-Path -Parent $scriptDir)
$runner = Join-Path $scriptDir 'daily-login.mjs'
$settingsReader = Join-Path $scriptDir 'settings.mjs'

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw 'node が見つかりません(PATHを確認してください)。' }

$selected = & $node $settingsReader '--scheduled-portals'
if ($LASTEXITCODE -ne 0) { throw '自動ログインの設定を読み込めないため停止しました。' }
# PS5.1はJSON配列を1個のオブジェクトとして出力するため、@(...)で二重に包まない。
$portalIds = ConvertFrom-Json -InputObject $selected

foreach ($portalId in $portalIds) {
  # ランナーは自前でログ出力し、成否をJSON1行でstdoutへ返す。ここでは値を解釈しない。
  & $node $runner '--portal' $portalId '--scheduled' | Out-Null
}

"local-login: $($portalIds.Count) ポータルを処理しました(詳細は logs/local-login-*.log)。"
