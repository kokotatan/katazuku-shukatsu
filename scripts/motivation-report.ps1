# motivation-report: logs/motivation-log.jsonl を時系列グラフ(ASCII)で表示する。
#
# 使い方:
#   powershell -File scripts/motivation-report.ps1           # 直近30件
#   powershell -File scripts/motivation-report.ps1 -Tail 90  # 直近90件
param(
  [int]$Tail = 30
)

$repo = Split-Path $PSScriptRoot -Parent
$logFile = Join-Path $repo 'logs\motivation-log.jsonl'
if (-not (Test-Path $logFile)) { "記録なし ($logFile)"; exit 0 }

$lines = Get-Content $logFile -Encoding UTF8 | Select-Object -Last $Tail
"モチベーショングラフ(直近$($lines.Count)件)  1-10、-=未評価"
""
foreach ($l in $lines) {
  try { $e = $l | ConvertFrom-Json } catch { continue }
  $day = ([datetime]$e.ts).ToString('MM/dd HH:mm')
  if ($null -ne $e.score) {
    $bar = ('#' * [int]$e.score).PadRight(10)
    $sc = ([string]$e.score).PadLeft(2)
  } else {
    $bar = '-'.PadRight(10)
    $sc = ' -'
  }
  $ev = if ($e.event) { " [$($e.event)]" } else { '' }
  "$day  $sc |$bar| $($e.note)$ev"
}
