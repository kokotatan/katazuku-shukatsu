# minipc-bootstrap: MiniPC を「自動運転の常駐機」として立ち上げる。
#
# 分担(2026-07-31 本人決定):
#   MiniPC : 見張り・同期・まとめ(mail-watch / daily-sync / calendar-sync / asa /
#            evening-brief / watchdog / local-login)+ 正本DB。24時間動かす
#   ノートPC: 会議URLの自動オープン・録音・議事録(Voicebox)。面接を受ける機械でしか録れないため
#
# 使い方(MiniPCで、リポジトリを git clone した後に実行):
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\minipc-bootstrap.ps1 -From D:\katazuku-transfer
#
# -WhatIf を付けると、何をするかだけ表示して変更しない。
param(
  [Parameter(Mandatory = $true)][string]$From,
  [switch]$WhatIf
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

if (-not (Test-Path $From)) { throw "転送フォルダが見つかりません: $From" }
$From = (Resolve-Path $From).Path

function Step($msg) { Write-Output "`n=== $msg" }
function Do-Copy($src, $dst, $label) {
  if (-not (Test-Path $src)) { Write-Output "  --  $label (転送フォルダに無い)"; return }
  if ($WhatIf) { Write-Output "  [WhatIf] $label -> $dst"; return }
  $parent = Split-Path $dst -Parent
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
  Copy-Item $src $dst -Recurse -Force
  Write-Output "  OK  $label"
}

# ---- 0. 前提ソフトの確認 ----
Step '前提ソフトの確認'
$missing = @()
foreach ($cmd in @('git', 'node', 'npx')) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { $missing += $cmd }
}
if (-not (Get-Command 'claude' -ErrorAction SilentlyContinue)) { $missing += 'claude (npm i -g @anthropic-ai/claude-code)' }
if (-not (Get-Command 'codex' -ErrorAction SilentlyContinue)) { Write-Output '  警告: codex が無い。Claudeの枠切れ時に引き継げない' }
if ($missing.Count) { throw ("先に導入してください: " + ($missing -join ' / ')) }
Write-Output ("  Node " + (& node --version))

# ---- 1. 実体データの配置 ----
Step '実体データを配置'
Do-Copy (Join-Path $From 'katazuku.db')    (Join-Path $repo 'data\katazuku.db')    '正本DB'
Do-Copy (Join-Path $From 'snapshot.json')  (Join-Path $repo 'data\snapshot.json')  'スナップショット'
Do-Copy (Join-Path $From 'dotenv.txt')     (Join-Path $repo '.env')                '.env(秘密)'
Do-Copy (Join-Path $From 'activity-log.jsonl') (Join-Path $repo 'logs\activity-log.jsonl') '活動ログ'
Do-Copy (Join-Path $From 'photos')         (Join-Path $repo 'data\private\photos') '人物写真'
Do-Copy (Join-Path $From 'credential-store') (Join-Path $repo 'credential-store')  '資格情報ブローカー'
Do-Copy (Join-Path $From 'google_workspace_mcp_credentials') (Join-Path $env:USERPROFILE '.google_workspace_mcp\credentials') 'OAuthトークン'
Get-ChildItem $From -Filter '*.local.md' -ErrorAction SilentlyContinue | ForEach-Object {
  Do-Copy $_.FullName (Join-Path $repo ('chrome-prompts\' + $_.Name)) $_.Name
}

# ---- 2. 依存の導入 ----
Step '依存パッケージの導入'
if ($WhatIf) { Write-Output '  [WhatIf] npm --prefix sync install' } else {
  npm --prefix (Join-Path $repo 'sync') install --no-audit --no-fund 2>&1 | Select-Object -Last 2
}

# ---- 3. 動作確認(登録の前に、実際に動くかを見る) ----
Step '動作確認'
if ($WhatIf) { Write-Output '  [WhatIf] DB読み取り・カレンダー取得の確認' } else {
  Push-Location (Join-Path $repo 'sync')
  try {
    npx tsx scripts/db-inspect.ts 2>&1 | Select-Object -First 3
    Write-Output '  --- カレンダー取得(OAuthが生きているかの確認)'
    npx tsx scripts/calendar-fetch.ts (Join-Path $repo 'sync\calendar-import-loop.json') 2>&1 | Select-Object -Last 2
  } finally { Pop-Location }
}

# ---- 4. 常時稼働の設定 ----
# ノートPCと違い、MiniPCは「閉じても寝ない」ことが価値なので、スリープ・休止を切る。
Step '常時稼働の設定(スリープ・休止を無効化)'
if ($WhatIf) { Write-Output '  [WhatIf] powercfg でスリープ無効化' } else {
  & powercfg.exe /change standby-timeout-ac 0 2>&1 | Out-Null
  & powercfg.exe /change hibernate-timeout-ac 0 2>&1 | Out-Null
  & powercfg.exe /change monitor-timeout-ac 15 2>&1 | Out-Null
  Write-Output '  OK  AC電源時はスリープ・休止しない(画面だけ15分で消す)'
}

# ---- 5. 定常タスクの登録(MiniPCで動かすものだけ) ----
# meeting-autopilot は登録しない。会議URLを開く・録音するのは面接を受けるノートPCの仕事。
Step '定常タスクの登録'
$tasks = @(
  'register-mail-watch.ps1',
  'register-daily-sync.ps1',
  'register-asa.ps1',
  'register-calendar-sync.ps1',
  'register-evening-brief.ps1',
  'register-watchdog.ps1',
  'register-local-login.ps1'
)
foreach ($t in $tasks) {
  $p = Join-Path $PSScriptRoot $t
  if (-not (Test-Path $p)) { Write-Output "  --  $t (無い)"; continue }
  if ($WhatIf) { Write-Output "  [WhatIf] $t"; continue }
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $p | Out-Null
  Write-Output "  OK  $t"
}

Step '完了'
Write-Output @'
次にやること:
  1. claude と codex にログインする(まだなら)
       claude    → laboauto12@gmail.com
       codex     → codex login
  2. google-workspace MCP が使えるか確認する。OAuthトークンは持ってきたが、
     再認証を求められたら okuyama.kotaro.career@gmail.com で通す
  3. ノートPC側で、MiniPCへ移した7本のタスクを無効化する(二重書き込みを防ぐ):
       Get-ScheduledTask -TaskName 'katazuku-mail-watch','katazuku-daily-sync','katazuku-asa',
         'katazuku-calendar-sync','katazuku-evening-brief','katazuku-watchdog','katazuku-local-login' |
         Disable-ScheduledTask
     ノートPCに残すのは katazuku-meeting-autopilot だけ(会議を開く・録音する役)
  4. 30分ほど置いてから番犬で健康確認:
       powershell -NoProfile -ExecutionPolicy Bypass -File scripts\watchdog.ps1
'@
