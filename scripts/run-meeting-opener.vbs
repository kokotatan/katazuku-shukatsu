' 会議URL自動オープンを「ウィンドウを一切表示せず」に起動するランチャ。
' タスクスケジューラからこの .vbs を wscript で呼ぶことで、PowerShellの黒いコンソールが
' 5分おきにチラつくのを防ぐ(第2引数 0 = 非表示ウィンドウ、第3引数 False = 完了を待たない)。
Dim shell
Set shell = CreateObject("WScript.Shell")
shell.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""C:\Users\okuya\katazuku-shukatsu\scripts\open-meeting-urls.ps1""", 0, False
Set shell = Nothing
