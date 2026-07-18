# activity-report: 活動ログ(logs/activity-log.jsonl)を人が読める形で表示する。
# 「何を・何のために・どうしたか・確認先」を日付ごとにまとめて出す。
#
# 使い方:
#   powershell -File scripts/activity-report.ps1            # 直近7日
#   powershell -File scripts/activity-report.ps1 -Days 1    # 直近1日
#   powershell -File scripts/activity-report.ps1 -Today     # 本日ぶんだけ
param(
  [int]$Days = 7,
  [switch]$Today
)

$repo = Split-Path $PSScriptRoot -Parent
$logFile = Join-Path $repo 'logs\activity-log.jsonl'
if (-not (Test-Path $logFile)) { "活動ログはまだありません ($logFile)"; return }

$entries = @()
foreach ($l in (Get-Content $logFile -Encoding utf8)) {
  if (-not $l.Trim()) { continue }
  try { $entries += ($l | ConvertFrom-Json) } catch {}
}
if (-not $entries) { "活動ログは空です"; return }

$cutoff = if ($Today) { (Get-Date).Date } else { (Get-Date).Date.AddDays(-$Days + 1) }
$rows = $entries |
  ForEach-Object { $_ | Add-Member -NotePropertyName _dt -NotePropertyValue ([datetimeoffset]::Parse($_.ts).LocalDateTime) -PassThru } |
  Where-Object { $_._dt -ge $cutoff } |
  Sort-Object _dt

if (-not $rows) { "対象期間に活動はありません"; return }

$title = if ($Today) { '本日' } else { "直近${Days}日" }
"=== 活動ログ ($title / $($rows.Count)件) ==="
$wd = @('日', '月', '火', '水', '木', '金', '土')
$lastDay = ''
foreach ($e in $rows) {
  $day = $e._dt.ToString('yyyy-MM-dd') + ' (' + $wd[[int]$e._dt.DayOfWeek] + ')'
  if ($day -ne $lastDay) { ""; "--- $day ---"; $lastDay = $day }
  "[{0}] {1,-16} {2}" -f $e._dt.ToString('HH:mm'), $e.by, $e.action
  if ($e.why)    { "    なぜ : $($e.why)" }
  if ($e.how)    { "    どう : $($e.how)" }
  if ($e.link)   { "    確認 : $($e.link)" }
  if ($e.result) { "    結果 : $($e.result)" }
}
