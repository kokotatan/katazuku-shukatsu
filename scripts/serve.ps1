# katazuku をローカル配信する(常時起動用)
# - Inbox はAI返信生成API付きの本番ビルド配信(vite preview)
# - コードを更新したら先に `npm run build` を実行すること
#
# ログオン時に自動起動させる登録(1回だけ):
#   schtasks /Create /TN "katazuku-serve" /SC ONLOGON `
#     /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\Users\okuya\katazuku-shukatsu\scripts\serve.ps1"
$root = Split-Path $PSScriptRoot -Parent

$apps = @(
  @{ name = 'inbox';    port = 4173 },
  @{ name = 'pipeline'; port = 4174 },
  @{ name = 'today';    port = 4175 },
  @{ name = 'notes';    port = 4176 },
  @{ name = 'prep';     port = 4177 }
)
foreach ($app in $apps) {
  Start-Process -WindowStyle Hidden powershell -ArgumentList @(
    '-NoProfile', '-Command',
    "Set-Location '$root\$($app.name)'; npx vite preview --host --port $($app.port)"
  )
}

"katazuku 配信中 (スマホからは localhost を <このPCのIP> に読み替え):"
foreach ($app in $apps) { "  $($app.name.PadRight(8)): http://localhost:$($app.port)/$($app.name)/" }
"停止: Get-Process -Name node | Stop-Process"
