# 本人のログイン時に録音状態を表示する。管理者権限・新しいクラウド資源は不要。
$ErrorActionPreference = 'Stop'
$startupDirectory = [Environment]::GetFolderPath('Startup')
$shortcutPath = Join-Path $startupDirectory 'katazuku-recording-status.lnk'
$launcher = Join-Path $PSScriptRoot 'start-recording-status.ps1'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}"' -f $launcher
$shortcut.WorkingDirectory = Split-Path $PSScriptRoot -Parent
$shortcut.WindowStyle = 7
$shortcut.Description = 'このPCの録音状態を表示'
$shortcut.Save()
& $launcher
Write-Output '録音状態表示をログイン時の起動に登録しました。'
