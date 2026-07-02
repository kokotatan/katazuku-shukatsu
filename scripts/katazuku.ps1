# katazuku — 統一コマンド。READMEの `katazuku <動詞>` 構想の入口。
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
  "(個人マスタは submit.local.md の§4〜§11)"
}

switch ($Command) {
  'asa'     {                                         # 朝のYes/No: メール分類→返信下書き→カレンダー→シート突合→prep。返事は最大3件
    Set-Location $root
    $prompt = Get-Content (Join-Path $root 'scripts\asa-prompt.md') -Raw -Encoding UTF8
    claude $prompt
  }
  'inbox'   {                                         # 連絡管理: asa と同じルーチン(旧inbox-triageを吸収)
    Set-Location $root
    $prompt = Get-Content (Join-Path $root 'scripts\asa-prompt.md') -Raw -Encoding UTF8
    claude $prompt
  }
  'inbox-web' { Open-App 'inbox' 4173 }               # 旧inbox: 取込メールの仕分けSPA(Web)
  'status'  { Open-App 'status' 4174 }                # 進捗管理: 全社の選考状況ボード
  'insight' { Open-App 'insight' 4175 }               # インテリジェンス: 当日サマリーと次アクション
  'profile' { Open-App 'profile' 4176 }               # 個人マスタ: ESデータの一元管理
  'prep'    {                                          # 直前対策(企業名を渡すと直行)
    $q = if ($Rest) { '?company=' + [uri]::EscapeDataString($Rest -join ' ') } else { '' }
    Open-App 'prep' 4177 $q
  }
  'company' { Start-Process $sheetUrl }               # 企業マスタ: 選考管理シート
  'submit'  {                                          # 個人データ入りの実戦版があればそちらを使う
    $f = if (Test-Path (Join-Path $root 'chrome-prompts\submit.local.md')) { 'submit.local.md' } else { '05-es-submit.md' }
    Copy-Prompt $f '書類提出(ES転記・提出)'
  }
  'test'    { Copy-Prompt '02-webtest-setup.md' '適性検査の予約・受検準備' }
  'sync'    {                                          # メール分析→シート更新→Inboxデータ更新→整理
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\daily-sync.ps1')
    "実行ログ: $root\logs\ を確認してください。"
  }
  'ask'     {                                          # 自分のデータにチャットで質問
    Set-Location $root
    claude ('就活データへの質問に答えるモード。選考管理シート・Gmail(MCP)・docs/PROGRESS.md を参照して答えて。質問: ' + ($Rest -join ' '))
  }
  'serve'   { & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'scripts\serve.ps1') }
  'build'   { Set-Location $root; npm run build }
  'today'   { Open-App 'insight' 4175 }               # 旧名のエイリアス
  'notes'   { Open-App 'profile' 4176 }               # 旧名のエイリアス
  'interview' { "未実装です。仕様: docs\specs\06-interview.md (面接録音から構造化メモ)" }
  'people'    { "未実装です。仕様: docs\specs\07-people.md (人脈整理)" }
  default {
    @"
katazuku <command>

  第一波
  submit     書類提出     ES転記プロンプトをコピー(Claude in Chromeへ)
  test       適性検査     受検準備プロンプトをコピー(受検代行はしない)
  asa        朝のYes/No   返信下書き・カレンダー・シート突合まで自動、あなたはYes/Noを返すだけ(毎朝9時)
  inbox      連絡管理     asa と同じルーチンを手動で実行
  inbox-web  連絡管理     取込メールの仕分けSPA (Web)

  土台
  profile    個人マスタ   ESデータの一元管理 (Web)
  company    企業マスタ   選考管理シートを開く

  第二波
  prep [社名] 直前対策    振り返り・想定問答・直前モード (Web)
  insight    当日把握     期限切れ/今日/今週の横断ビュー (Web)
  ask <質問>  ヘルプデスク 自分の就活データにClaudeで質問
  status     進捗管理     全社の選考状況ボード (Web)

  第三波(未実装、specs/06-07)
  interview  面接ログ  /  people  人脈整理

  運用
  sync       同期実行     メール分析→シート更新→整理(毎朝も自動実行)
  serve      配信開始     全アプリをローカル配信
  build      ビルド
"@
  }
}
