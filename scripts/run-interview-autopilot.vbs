' Start one pass of interview-autopilot without showing any console window (used by Task Scheduler).
' Usage: wscript.exe run-interview-autopilot.vbs [--apply | --bundle] [other options]
Dim shell, fso, scriptDir, repo, tsx, args, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repo = fso.GetParentFolderName(scriptDir)
tsx = repo & "\node_modules\tsx\dist\cli.mjs"
args = ""
For i = 0 To WScript.Arguments.Count - 1
  args = args & " """ & WScript.Arguments(i) & """"
Next
shell.CurrentDirectory = repo
WScript.Quit shell.Run("node """ & tsx & """ scripts\interview-autopilot.ts" & args, 0, True)
