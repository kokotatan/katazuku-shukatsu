' 朝のまとめ(asa-auto.ps1)を「ウィンドウを一切表示せず」に起動するランチャ。
' タスクスケジューラから wscript で呼び、結果を本人のGmailへ送って終わる。
Dim shell
Dim fso
Dim scriptDir
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\asa-auto.ps1""", 0, True
Set shell = Nothing
Set fso = Nothing
