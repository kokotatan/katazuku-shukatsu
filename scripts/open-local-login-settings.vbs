' 自動ログイン設定を準備してブラウザを開く。コンソールは表示しない。
Dim shell, fso, repo, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
repo = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = repo
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & repo & "\scripts\local-login\open-settings.ps1"""
shell.Run command, 0, False
