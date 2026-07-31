# katazuku 前夜ブリーフ (Windowsタスクスケジューラから毎晩起動する)
# 明日の面接・面談があれば、相手情報・前回記録・想定問答をまとめて自分宛メールで届ける。
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("evening-brief-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

$invoke = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$runId = 'evening-brief:' + (Get-Date -Format 'yyyy-MM-dd')
try {
  & $invoke -Workflow 'evening-brief' -RunId $runId `
    -PromptFile (Join-Path $PSScriptRoot 'evening-brief-prompt.md') `
    -Risk 'external-commit' -SideEffectMode 'reconcile' `
    -Capability @('workspace.read', 'shell', 'gmail.read', 'gmail.send') `
    -TimeoutMs 1200000 `
    *>&1 | Out-File -FilePath $logFile -Encoding utf8
} catch {
  $_ | Out-File -FilePath $logFile -Append -Encoding utf8
}

# 完了センチネル方式(daily-syncと同じ)。失敗の疑いは alert に残し asa が翌朝報告する
$alertFile = Join-Path $logDir 'alert-daily-sync.txt'
$ok = $false
if ((Test-Path $logFile) -and (Get-Item $logFile).Length -ge 200) {
  $logText = Get-Content -Raw -Encoding UTF8 $logFile
  if ($logText -match '===\s*evening-brief\s*DONE\s*===') { $ok = $true }
}
if (-not $ok) {
  ("{0} evening-brief 失敗: 完了行なし (詳細: logs/{1})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (Split-Path $logFile -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
}

Get-ChildItem $logDir -Filter 'evening-brief-*.log' |
  Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } |
  Remove-Item -Force
