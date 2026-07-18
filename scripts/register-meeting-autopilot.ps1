# meeting-autopilot をタスクスケジューラに登録する(5分毎)。
# 旧 katazuku-meeting-opener(カレンダー直読み)が残っている場合は二重に開くので無効化する:
#   schtasks /Change /TN "katazuku-meeting-opener" /DISABLE
# 実行(1回): powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-meeting-autopilot.ps1
$script = Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts\meeting-autopilot.ps1'
$tr = "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
schtasks /Create /F /TN 'katazuku-meeting-autopilot' /SC MINUTE /MO 5 /TR $tr
if ($LASTEXITCODE -eq 0) {
  Write-Output '登録完了: katazuku-meeting-autopilot (5分毎)'
  Write-Output '旧openerが残っていれば: schtasks /Change /TN "katazuku-meeting-opener" /DISABLE'
} else {
  Write-Output '登録失敗。管理者権限が必要な場合があります'
}
