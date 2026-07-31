# self-update: MiniPC(常駐機)が GitHub の最新コードへ追従する。
#
# なぜ必要か: 開発はノートPCで行い、定時処理はMiniPCで動く。pushしただけでは
# MiniPCは古いコードのまま動き続けるので、直したはずの不具合が現場で再発する。
#
# 安全のための制約:
#   - fast-forward のみ(ローカルに手を入れていたら止まる。勝手にマージ・リセットしない)
#   - 定時処理が走っている最中は更新しない(実行中のスクリプトを差し替えない)
#   - 更新があったときだけ npm install と全チェックを走らせ、落ちたら元へ戻す
#
# 使い方: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\self-update.ps1
# 定期実行にするなら1日1回で十分(タスク登録は register-self-update.ps1)。
$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$log = Join-Path $logDir 'self-update.log'
function Log($m) { ("{0} {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Tee-Object -FilePath $log -Append }

# 実行中の定常タスクがあれば見送る(走っているスクリプトを差し替えると途中で挙動が変わる)
$running = @(Get-ScheduledTask -TaskName 'katazuku-*' -ErrorAction SilentlyContinue |
  Where-Object { $_.State -eq 'Running' -and $_.TaskName -ne 'katazuku-self-update' })
if ($running.Count -gt 0) {
  Log ("実行中のタスクがあるため見送る: {0}" -f (($running | ForEach-Object { $_.TaskName }) -join ', '))
  exit 0
}

# ローカルに未コミットの変更があれば止める(常駐機で手を入れているのは異常。上書きしない)
$dirty = & git status --porcelain 2>&1 | Where-Object { $_ -notmatch '^\?\?' }
if ($dirty) {
  Log "未コミットの変更があるため更新しない。常駐機では編集しないこと:`n$($dirty -join "`n")"
  exit 1
}

$before = (& git rev-parse HEAD 2>&1).Trim()
& git fetch origin 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
$behind = (& git rev-list --count HEAD..origin/main 2>&1).Trim()
if ($behind -eq '0') { Log '最新。更新なし'; exit 0 }

Log "$behind 件の更新がある。fast-forwardで取り込む"
& git merge --ff-only origin/main 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) { Log 'fast-forwardできない(履歴が分岐している)。手動で確認が要る'; exit 1 }
$after = (& git rev-parse HEAD 2>&1).Trim()

# 依存が変わっていたら入れ直す
$changed = & git diff --name-only $before $after 2>&1
if ($changed -match 'package(-lock)?\.json') {
  Log '依存が変わったので npm install'
  npm --prefix (Join-Path $repo 'sync') install --no-audit --no-fund 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
}

# 取り込んだコードが壊れていないか確認し、駄目なら元へ戻す(常駐機を壊れた状態で放置しない)
npm run check 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
if ($LASTEXITCODE -ne 0) {
  Log "更新後のチェックに失敗。$before へ戻す"
  & git reset --hard $before 2>&1 | Out-File -FilePath $log -Append -Encoding utf8
  ("{0} self-update 失敗: 取り込んだコードでチェックが落ちたため巻き戻した" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss')) |
    Out-File -FilePath (Join-Path $logDir 'alert-self-update.txt') -Append -Encoding utf8
  exit 1
}

Log "更新完了: $($before.Substring(0,7)) -> $($after.Substring(0,7))"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') `
  -By 'self-update' -Action ("常駐機のコードを更新({0}件)" -f $behind) `
  -Why 'ノートPCで直した内容を常駐機の定時処理へ反映するため' `
  -How ("git fast-forward {0}->{1} + 全チェック通過" -f $before.Substring(0, 7), $after.Substring(0, 7)) `
  -Link 'logs/self-update.log' -Result '成功' | Out-Null
