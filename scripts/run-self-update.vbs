' self-update.ps1をウィンドウを表示せずに起動するランチャ。
' タスクスケジューラからwscriptで呼び、完了まで待って終了コードを返す。
Dim shell
Dim fso
Dim scriptDir
Dim exitCode
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
exitCode = shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptDir & "\self-update.ps1""", 0, True)
Set shell = Nothing
Set fso = Nothing
WScript.Quit exitCode
