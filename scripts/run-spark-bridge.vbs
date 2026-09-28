Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptPath = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "run-spark-bridge.ps1")
WScript.Quit shell.Run("powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & scriptPath & """", 0, True)
