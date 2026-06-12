# katazuku — 統一コマンド。当初構想の `katazuku <command>` を既存実装に接続する入口。
# セットアップ(1回): PowerShellプロファイルに次の1行を追加
#   function katazuku { & "C:\Users\okuya\katazuku-shukatsu\scripts\katazuku.ps1" @args }
param(
  [Parameter(Position = 0)] [string] $Command = 'help',
  [Parameter(Position = 1, ValueFromRemainingArguments = $true)] [string[]] $Rest
)
$root = Split-Path $PSScriptRoot -Parent
$sheetUrl = 'https://docs.google.com/spreadsheets/d/1X6z04LUU5IHvzJLoKQiHpdc_ml21Dor3XDDdz9rWLx0'

function Ensure-Serve {
  try {
    Invoke-WebRequest -Uri 'http://localhost:4173/inbox/' -UseBasicParsing -TimeoutSec 2 | Out-Null
  } catch {
    "配信サーバーを起動します..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\serve.ps1') | Out-Null
    Start-Sleep -Seconds 3
  }
}

function Open-App([string] $app, [int] $port, [string] $query = '') {
  Ensure-Serve
  Start-Process "http://localhost:$port/$app/$query"
}

function Copy-Prompt([string] $file, [string] $label) {
  $path = Join-Path $root "chrome-prompts\$file"
  Get-Content $path -Raw -Encoding UTF8 | Set-Clipboard
  "$label のプロンプトをクリップボードにコピーしました。"
  "Chromeで対象ページを開き、Claude in Chrome に貼り付けてください。"
  "(_profile.local.md の個人情報も忘れずに)"
}

switch ($Command) {
  'inbox'   { Open-App 'inbox' 4173 }                 # 連絡管理: 仕分け・返信下書き
  'status'  { Open-App 'pipeline' 4174 }              # 進捗管理: 全社の選考状況ボード
  'today'   { Open-App 'today' 4175 }                 # 今日やること
  'notes'   { Open-App 'notes' 4176 }                 # ES部品庫
  'prep'    {                                          # 直前対策(企業名を渡すと直行)
    $q = if ($Rest) { '?company=' + [uri]::EscapeDataString($Rest -join ' ') } else { '' }
    Open-App 'prep' 4177 $q
  }
  'company' { Start-Process $sheetUrl }               # 企業マスタ: 選考管理シート
  'profile' {                                          # 個人マスタ(ブラウザ操作用プロフィール)
    $local = Join-Path $root 'chrome-prompts\_profile.local.md'
    if (-not (Test-Path $local)) { Copy-Item (Join-Path $root 'chrome-prompts\_profile.md') $local }
    Start-Process notepad $local
  }
  'submit'  { Copy-Prompt '05-es-submit.md' '書類提出(ES転記・提出)' }
  'test'    { Copy-Prompt '02-webtest-setup.md' '適性検査の予約・受検準備' }
  'insight' {                                          # 当日サマリーと次アクション(=毎朝の同期を手動実行)
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\daily-sync.ps1')
    "実行ログ: $root\logs\ を確認してください。"
  }
  'ask'     {                                          # 自分のデータにチャットで質問
    Set-Location $root
    claude ('就活データへの質問に答えるモード。選考管理シート・Gmail(MCP)・docs/PROGRESS.md を参照して答えて。質問: ' + ($Rest -join ' '))
  }
  'serve'   { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\serve.ps1') }
  'build'   { Set-Location $root; npm run build }
  'interview' { "未実装です。仕様: docs\specs\06-interview.md (面接録音から構造化メモ)" }
  'people'    { "未実装です。仕様: docs\specs\07-people.md (人脈整理)" }
  default {
    @"
katazuku <command>

  inbox      連絡管理     メール仕分け・AI返信下書き (Web)
  status     進捗管理     全社の選考状況ボード (Web)
  today      今日         期限切れ/今日/今週の横断ビュー (Web)
  notes      ES部品庫     ガクチカ・研究概要の使い回し (Web)
  prep [社名] 直前対策    振り返り・想定問答・直前モード (Web)
  company    企業マスタ   選考管理シートを開く
  profile    個人マスタ   ブラウザ操作用プロフィールを編集
  submit     書類提出     Claude in Chrome 用プロンプトをコピー
  test       適性検査     受検準備プロンプトをコピー(受検代行はしない)
  insight    今日の頭出し メール分析→シート更新→整理を手動実行
  ask <質問>  ヘルプデスク 自分の就活データにClaudeで質問
  serve      配信開始     5アプリをローカル配信
  build      ビルド       全アプリをビルド
  interview / people      第三波(未実装、specs参照)
"@
  }
}
