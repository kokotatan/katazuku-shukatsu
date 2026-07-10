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

# ログの肥大化防止: 512KB を超えていたら末尾100KBだけ残して切り詰める
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 512KB)) {
  $bytes = [System.IO.File]::ReadAllBytes($log)
  $keep = $bytes[($bytes.Length - 100KB)..($bytes.Length - 1)]
  [System.IO.File]::WriteAllBytes($log, $keep)
}

# 無効なAPIキーが混入していると認証エラーになるので、このプロセスでは外す
$env:ANTHROPIC_API_KEY = $null

$now = Get-Date -Format 'yyyy-MM-dd HH:mm'
$prompt = ("現在時刻は {0} (JST) です。この時刻を基準に判断してください。`n" -f $now) + @'
カレンダーMCPツール(mcp__google-workspace__* または mcp__claude_ai_Google_Calendar__* のうち使える方)を使い、
カレンダー okuyama.kotaro.career@gmail.com の予定のうち、
「現在時刻から12分以内に開始」する予定で、location・description・会議リンクのいずれかに
meet.google.com もしくは zoom.us のURLを含むものを探してください。
該当する各予定について {"title": 件名, "start": 開始時刻, "url": 会議URL} を作り、JSON配列だけを出力。
説明文・コードフェンス・前置きは一切書かない。該当なしなら [] だけを出力してください。
'@

$out = & claude -p $prompt --model claude-haiku-4-5-20251001 `
  --allowedTools 'mcp__google-workspace__get_events' 'mcp__google-workspace__list_calendars' `
    'mcp__claude_ai_Google_Calendar__*' 2>$null | Out-String
Log ("raw: {0}" -f $out.Trim())

$alertFile = Join-Path $logDir 'alert-meeting-opener.txt'
$m = [regex]::Match($out, '\[.*\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)
if (-not $m.Success) {
  Log 'JSON配列が見つからない'
  # 認証系の失敗と思われるときだけ alert に残す(asa が【自動化の故障】として報告する)。同日は1回だけ追記
  if ($out -match '認証|許可|ログイン') {
    $alreadyToday = (Test-Path $alertFile) -and ((Get-Content -Raw $alertFile) -match [regex]::Escape($today))
    if (-not $alreadyToday) {
      $head = $out.Trim()
      if ($head.Length -gt 200) { $head = $head.Substring(0, 200) }
      ("{0} meeting-opener 失敗(認証系の疑い): {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $head) |
        Out-File -FilePath $alertFile -Append -Encoding utf8
    }
  }
  return
}
# JSONが取れた正常時は故障アラートを消す
if (Test-Path $alertFile) { Remove-Item $alertFile -Force }
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
