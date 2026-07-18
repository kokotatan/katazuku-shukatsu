# katazukuの定常タスク5本をまとめて登録する。
$ErrorActionPreference = 'Stop'
$files = @(
  'register-mail-watch.ps1',
  'register-daily-sync.ps1',
  'register-asa.ps1',
  'register-calendar-sync.ps1',
  'register-meeting-autopilot.ps1'
)
foreach ($file in $files) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot $file)
  if ($LASTEXITCODE -ne 0) { throw "登録失敗: $file" }
}
Write-Output 'katazuku定常タスク5本を登録しました'
