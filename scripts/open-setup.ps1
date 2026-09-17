$ErrorActionPreference = 'Stop'
$repo = [System.IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent)).TrimEnd('\')
function Test-SameWorkspace($probe) {
  if ($probe.service -ne 'katazuku-setup' -or -not $probe.workspace) { return $false }
  return [System.IO.Path]::GetFullPath([string]$probe.workspace).TrimEnd('\') -ieq $repo
}
try {
  $selectedPort = $null
  foreach ($candidatePort in 18472..18491) {
    $candidateUrl = 'http://127.0.0.1:' + $candidatePort + '/'
    try {
      $probe = Invoke-RestMethod ($candidateUrl + 'api/status') -TimeoutSec 1
      if (Test-SameWorkspace $probe) { Start-Process $candidateUrl; exit 0 }
      continue
    } catch { }
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $candidatePort)
    try { $listener.Start(); if ($null -eq $selectedPort) { $selectedPort = $candidatePort } } catch { } finally { $listener.Stop() }
  }
  if ($null -eq $selectedPort) { throw '設定画面のポートを確保できませんでした。' }
  $url = 'http://127.0.0.1:' + $selectedPort + '/'
  $bundled = Join-Path $repo 'runtime/node.exe'
  $node = if (Test-Path -LiteralPath $bundled) { $bundled } else { (Get-Command node -ErrorAction Stop).Source }
  Start-Process -FilePath $node -ArgumentList ('"' + (Join-Path $repo 'tools/setup/server.mjs') + '" --port ' + $selectedPort) -WorkingDirectory $repo -WindowStyle Hidden
  for ($attempt = 0; $attempt -lt 30; $attempt++) {
    Start-Sleep -Milliseconds 200
    try { $probe = Invoke-RestMethod ($url + 'api/status') -TimeoutSec 1; if (Test-SameWorkspace $probe) { Start-Process $url; exit 0 } } catch { }
  }
  throw '起動できませんでした。'
} catch {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('設定画面を起動できませんでした。PC用アプリを展開し直してお試しください。', 'katazukuの設定') | Out-Null
  exit 1
}
