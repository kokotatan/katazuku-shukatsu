' Start one katazuku workflow without showing any console window (used by Task Scheduler).
' Usage: wscript.exe run-workflow.vbs <workflow-name>
Dim shell, fso, scriptDir, repo, tsx, name
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
If WScript.Arguments.Count < 1 Then WScript.Quit 1
name = WScript.Arguments(0)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
repo = fso.GetParentFolderName(scriptDir)
tsx = repo & "\node_modules\tsx\dist\cli.mjs"
shell.CurrentDirectory = repo
WScript.Quit shell.Run("node """ & tsx & """ scripts\workflow.ts " & name, 0, True)
