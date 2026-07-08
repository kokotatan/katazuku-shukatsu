# katazuku 会議URL自動オープン
# careerカレンダーを見て、約10分以内に始まる会議(Meet/Zoom URL付き)を既定ブラウザ(Chrome)で開く。
# タスクスケジューラから5分おきに起動される想定。LLMはHaiku(軽処理・安価)。
# 同じURLは1日1回だけ開く(state file で重複防止)。

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$today = Get-Date -Format 'yyyy-MM-dd'
$stateFile = Join-Path $logDir ("opened-meetings-{0}.txt" -f $today)
$log = Join-Path $logDir 'meeting-opener.log'
function Log($m) { ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }

# 無効なAPIキーが混入していると認証エラーになるので、このプロセスでは外す
$env:ANTHROPIC_API_KEY = $null

$now = Get-Date -Format 'yyyy-MM-dd HH:mm'
$prompt = ("現在時刻は {0} (JST) です。この時刻を基準に判断してください。`n" -f $now) + @'
google-workspace のカレンダーツールを使い、カレンダー okuyama.kotaro.career@gmail.com の予定のうち、
「現在時刻から12分以内に開始」する予定で、location・description・会議リンクのいずれかに
meet.google.com もしくは zoom.us のURLを含むものを探してください。
該当する各予定について {"title": 件名, "start": 開始時刻, "url": 会議URL} を作り、JSON配列だけを出力。
説明文・コードフェンス・前置きは一切書かない。該当なしなら [] だけを出力してください。
'@

$out = & claude -p $prompt --model claude-haiku-4-5-20251001 `
  --allowedTools 'mcp__google-workspace__get_events' 'mcp__google-workspace__list_calendars' 2>$null | Out-String
Log ("raw: {0}" -f $out.Trim())

$m = [regex]::Match($out, '\[.*\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $m.Success) { Log 'JSON配列が見つからない'; return }
try { $events = $m.Value | ConvertFrom-Json } catch { Log ("JSON解析失敗: {0}" -f $_); return }
if (-not $events -or $events.Count -eq 0) { Log '直近に開くべき会議なし'; return }

$opened = @()
if (Test-Path $stateFile) { $opened = @(Get-Content $stateFile) }

foreach ($e in $events) {
  if (-not $e.url) { continue }
  if ($opened -contains $e.url) { Log ("既に開済: {0}" -f $e.url); continue }
  Start-Process $e.url
  Add-Content -Path $stateFile -Value $e.url
  Log ("開いた: {0} -> {1}" -f $e.title, $e.url)
}
