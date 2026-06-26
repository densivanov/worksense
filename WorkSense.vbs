Set oShell = CreateObject("WScript.Shell")
sDir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
oShell.Run "cmd /c cd /d """ & sDir & """ && npx electron .", 0, False
