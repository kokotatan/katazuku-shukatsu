' 会議URL自動オープンを「ウィンドウを一切表示せず」に起動するランチャ。
' タスクスケジューラからこの .vbs を wscript で呼ぶことで、PowerShellの黒いコンソールが
' 5分おきにチラつくのを防ぐ(第2引数 0 = 非表示ウィンドウ、第3引数 False = 完了を待たない)。
Dim shell, fso, scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\open-meeting-urls.ps1""", 0, False
Set fso = Nothing
Set shell = Nothing
