# ダブルクリック用。画面が未ビルドなら準備し、ループバックの設定画面を開く。
$ErrorActionPreference = 'Stop'
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$url = 'http://127.0.0.1:18471/board/local-login/'
try {
  $probe = Invoke-RestMethod 'http://127.0.0.1:18471/api/local-login/session' -TimeoutSec 2
  if ($probe.service -eq 'katazuku-local-login') { Start-Process $url -WindowStyle Normal; exit 0 }
} catch { }
try {
  $node = (Get-Command node -ErrorAction Stop).Source
  Push-Location $repo
  try {
    # PS5.1ではnpmのstderrに出る通知を例外扱いせず、終了コードで判断する。
    $ErrorActionPreference = 'Continue'
    try {
      if (-not (Test-Path -LiteralPath (Join-Path $repo 'board/node_modules'))) {
        & npm.cmd --prefix board ci *> $null
        if ($LASTEXITCODE -ne 0) { throw '画面の依存関係を準備できませんでした。' }
      }
      & npm.cmd --prefix board run build *> $null
      if ($LASTEXITCODE -ne 0) { throw '設定画面をビルドできませんでした。' }
    } finally { $ErrorActionPreference = 'Stop' }
    & $node (Join-Path $PSScriptRoot 'settings-server.mjs') '--open'
    if ($LASTEXITCODE -ne 0) { throw '設定画面を起動できませんでした。' }
  } finally { Pop-Location }
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('設定画面を起動できませんでした。Node.jsを確認し、katazukuフォルダで npm run local-login:settings を実行してください。', 'katazuku 自動ログイン設定') | Out-Null
  exit 1
}
