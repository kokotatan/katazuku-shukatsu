# katazuku 会議URL自動オープン + 録画セッション起動
# careerカレンダーを見て、約12分以内に始まる会議(Meet/Zoom/Teams URL付き)を既定ブラウザで開く。
# さらに開いた各会議について record-session.ps1 を切り離し起動し、開始時刻ちょうどに録画→終了で議事録化する。
# タスクスケジューラから5分おきに起動される想定。LLMはHaiku(軽処理・安価)。
# 同じURLは1日1回だけ開く(state file で重複防止=録画セッションも1会議1回だけ起動)。

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
meet.google.com / zoom.us / teams.microsoft.com、または短縮リンク
(weburl.jp / bit.ly / tinyurl.com / x.gd / cutt.ly / is.gd / t.co / lnkd.in / ur0.cc / urx.nu / buff.ly / rebrand.ly)
のいずれかのURLを含むものを探してください。短縮リンクは実ブラウザで開けばMeet等へリダイレクトされるので、そのまま url にする。
各予定について {"title": 件名, "start": "YYYY-MM-DD HH:mm", "end": "YYYY-MM-DD HH:mm", "url": 会議URL} を作る。

出力は JSON 配列そのものだけ。表・箇条書き・見出し・コードフェンス・前置き・後書きを一切含めてはならない。
1文字目は必ず [ で、最後の文字は ] にすること。該当なしなら [] だけを出力。
例: [{"title":"面談","start":"2026-07-15 14:00","end":"2026-07-15 15:00","url":"https://meet.google.com/xxx"}]
'@

# Haikuが指示に反して表を返すことがあるため、JSON配列が取れるまで最大3回試す
$out = ''
$m = $null
for ($try = 1; $try -le 3; $try++) {
  $out = & claude -p $prompt --model claude-haiku-4-5-20251001 `
    --allowedTools 'mcp__google-workspace__get_events' 'mcp__google-workspace__list_calendars' `
      'mcp__claude_ai_Google_Calendar__*' 2>$null | Out-String
  Log ("raw(try {0}): {1}" -f $try, $out.Trim())
  $m = [regex]::Match($out, '\[.*\]', [System.Text.RegularExpressions.RegexOptions]::Singleline)
  if ($m.Success) { break }
  Log ("JSON配列が取れず。再試行 {0}/3" -f $try)
}

$alertFile = Join-Path $logDir 'alert-meeting-opener.txt'
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

$recordSession = Join-Path $PSScriptRoot 'record-session.ps1'

foreach ($e in $events) {
  if (-not $e.url) { continue }
  if ($opened -contains $e.url) { Log ("既に開済: {0}" -f $e.url); continue }
  Start-Process $e.url
  Add-Content -Path $stateFile -Value $e.url
  Log ("開いた: {0} -> {1}" -f $e.title, $e.url)

  # 開始時刻ちょうどに録画→終了で議事録、を担う録画セッションを切り離して起動(ポーリングなし)
  $recArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
    '-File', ('"{0}"' -f $recordSession), '-Url', ('"{0}"' -f $e.url), '-Title', ('"{0}"' -f $e.title))
  if ($e.start) { $recArgs += @('-StartTime', ('"{0}"' -f $e.start)) }
  if ($e.end)   { $recArgs += @('-EndTime',   ('"{0}"' -f $e.end)) }
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList $recArgs
  Log ("録画セッション起動: {0} [{1}-{2}]" -f $e.title, $e.start, $e.end)
}
