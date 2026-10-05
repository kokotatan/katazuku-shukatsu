Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
script = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "run-spark-worker.ps1")
WScript.Quit shell.Run("powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File """ & script & """", 0, True)
