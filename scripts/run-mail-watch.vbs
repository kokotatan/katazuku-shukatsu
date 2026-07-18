' メール見張り(mail-watch.ps1)を「ウィンドウを一切表示せず」に起動するランチャ。
' タスクスケジューラから wscript で呼び、毎時の黒いコンソール表示を防ぐ。
Dim shell
Dim fso
Dim scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\mail-watch.ps1""", 0, True
Set shell = Nothing
Set fso = Nothing
