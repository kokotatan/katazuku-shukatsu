Option Explicit

Dim shell, fileSystem, scriptDirectory, guardScript, command

Set shell = CreateObject("WScript.Shell")
Set fileSystem = CreateObject("Scripting.FileSystemObject")

scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
guardScript = fileSystem.BuildPath(scriptDirectory, "emergency-failover.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File " & Chr(34) & guardScript & Chr(34) & " -Operation guard"

shell.Run command, 0, False
