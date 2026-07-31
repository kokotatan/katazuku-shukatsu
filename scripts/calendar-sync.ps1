# Google Calendar -> appointment の定期同期
#
# 2026-07-31 改修: 本体を決定的スクリプト(sync/scripts/calendar-fetch.ts)に置き換えた。
# それまでは30分ごと=1日48回、丸ごとLLMに投げていた。取得・正規化・DB反映に判断は要らないのに
# provider の枠を食い尽くし、mail-watch や asa など「判断が要る処理」まで quota_exhausted で
# 落としていた(直近5日で quota_exhausted 130回)。
# LLMを呼ぶのは、企業名を機械的に特定できなかった「要判定」の予定がある場合だけにする。
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$logFile = Join-Path $logDir ("calendar-sync-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))
$alertFile = Join-Path $logDir 'alert-calendar-sync.txt'
$importJson = Join-Path $repo 'sync\calendar-import-loop.json'
$residueJson = Join-Path $repo 'sync\calendar-import-loop-residue.json'

function Log($m) { ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $logFile -Append -Encoding utf8 }
function Fail($reason) {
  Log $reason
  ("{0} calendar-sync 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $reason, (Split-Path $logFile -Leaf)) |
    Out-File -FilePath $alertFile -Append -Encoding utf8
  exit 1
}

# ---- 1. 決定的な取得と正規化(LLMなし) ----
$fetchOk = $false
try {
  Push-Location (Join-Path $repo 'sync')
  npx tsx scripts/calendar-fetch.ts $importJson 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
  $fetchOk = ($LASTEXITCODE -eq 0) -and (Test-Path $importJson)
} finally { Pop-Location }
if (-not $fetchOk) { Fail 'カレンダーを取得できず(OAuthトークン切れならgoogle-workspace MCPで再認証が要る)' }

# ---- 2. DB反映(決定的) ----
$applyOk = $false
try {
  Push-Location (Join-Path $repo 'sync')
  npx tsx scripts/db-apply-calendar.ts $importJson 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
  if ($LASTEXITCODE -eq 0) {
    npx tsx scripts/db-snapshot.ts 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    $applyOk = ($LASTEXITCODE -eq 0)
  }
} finally { Pop-Location }
if (-not $applyOk) { Fail 'DBへ反映できず(db-apply-calendar / db-snapshot)' }

# ---- 3. 要判定の予定があるときだけLLMを呼ぶ ----
# 「リンモチ面接」「バクラク ハッカソン」のような、DBに無い略称・製品名だけで書かれた予定。
# 機械的には企業を特定できないが捨ててはいけないので、ここだけ判断を借りる。
# ただし「前回も解決できなかった同じ予定」を30分ごとに投げ直すのは枠の無駄なので、
# 一度LLMに見せた externalId は記録しておき、新しく現れたものがある時だけ起動する。
# (東北大の定期試験のように、そもそも企業に紐付かない予定が要判定に残り続けるため)
$seenFile = Join-Path $logDir 'calendar-residue-seen.local.json'
$residueCount = 0
$newResidue = @()
if (Test-Path $residueJson) {
  try {
    $ids = @((Get-Content -Raw -Encoding UTF8 $residueJson | ConvertFrom-Json).events) | ForEach-Object { $_.externalId }
    $residueCount = $ids.Count
    $seen = @()
    if (Test-Path $seenFile) { try { $seen = @((Get-Content -Raw -Encoding UTF8 $seenFile | ConvertFrom-Json)) } catch { $seen = @() } }
    $newResidue = @($ids | Where-Object { $seen -notcontains $_ })
  } catch { $residueCount = 0 }
}
if ($newResidue.Count -gt 0) {
  Log ("要判定{0}件(うち新規{1}件)。新規があるためLLMへ回す" -f $residueCount, $newResidue.Count)
  $runId = 'calendar-residue:' + (Get-Date -Format 'yyyy-MM-dd-HHmm')
  try {
    & (Join-Path $PSScriptRoot 'invoke-agent.ps1') -Workflow 'calendar-sync' -RunId $runId `
      -PromptFile (Join-Path $PSScriptRoot 'calendar-residue-prompt.md') `
      -Risk 'db-write' -SideEffectMode 'reconcile' `
      -Capability @('workspace.read', 'workspace.write', 'shell') `
      -TimeoutMs 600000 `
      *>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    # 解決できたか否かに関わらず「一度見せた」ことを記録する。解決できなかったものを
    # 30分ごとに投げ直しても結果は変わらず、枠だけ減るため。新しい予定が来れば再度動く。
    $allSeen = @()
    if (Test-Path $seenFile) { try { $allSeen = @((Get-Content -Raw -Encoding UTF8 $seenFile | ConvertFrom-Json)) } catch { $allSeen = @() } }
    $allSeen = @($allSeen + $newResidue | Select-Object -Unique) | Select-Object -Last 500
    $allSeen | ConvertTo-Json -Compress | Out-File -FilePath $seenFile -Encoding utf8
  } catch {
    # 要判定分が処理できなくても確定分の同期は済んでいる。枠切れなら次回に持ち越す(失敗にしない)
    Log ("要判定の処理はできなかった(確定分の同期は成功。次回再試行): {0}" -f $_)
  }
} elseif ($residueCount -gt 0) {
  Log ("要判定{0}件はすべて既出のためLLMは呼ばない" -f $residueCount)
}

# ---- 4. 活動ログと後始末 ----
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') `
  -By 'calendar-sync' -Action 'カレンダー予定のDB同期' `
  -Why '会議自動運転の予定を最新にするため' `
  -How ("決定的取得(LLMなし)。要判定{0}件" -f $residueCount) `
  -Link 'data/katazuku.db' -Result '成功' | Out-Null

Log '=== calendar-sync DONE ==='
if (Test-Path $alertFile) { Remove-Item $alertFile -Force }
Get-ChildItem $logDir -Filter 'calendar-sync-*.log' | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force
