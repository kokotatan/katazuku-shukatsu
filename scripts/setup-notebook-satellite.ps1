[CmdletBinding()]
param(
  [ValidatePattern('^[A-Za-z0-9._-]+$')][string]$MiniPcHost = 'KOKOTATANPC',
  [string]$MiniPcRepo = 'C:\Users\okuya\katazuku-shukatsu-private'
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
if ([Environment]::MachineName -ieq $MiniPcHost) {
  throw 'Run this setup on the notebook, not on the MiniPC.'
}
if ($MiniPcRepo -match '["\r\n]') { throw 'MiniPcRepo contains unsupported characters.' }

$marker = Join-Path $repo '.katazuku-satellite'
if (-not (Test-Path -LiteralPath $marker)) {
  [IO.File]::WriteAllText($marker, "notebook`n", (New-Object Text.UTF8Encoding($false)))
}

$localDir = Join-Path $repo 'logs'
if (-not (Test-Path -LiteralPath $localDir)) { New-Item -ItemType Directory -Path $localDir | Out-Null }
$configPath = Join-Path $localDir 'notebook-minipc.local.json'
$config = [ordered]@{ host = $MiniPcHost; repo = $MiniPcRepo }
[IO.File]::WriteAllText($configPath, ($config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))

$ssh = Get-Command ssh.exe -ErrorAction Stop
$probe = & $ssh.Source -o BatchMode=yes -o ConnectTimeout=10 $MiniPcHost hostname 2>&1
if ($LASTEXITCODE -ne 0) {
  throw "SSH probe failed. Run 'ssh $MiniPcHost' once to trust the host and configure the key. Detail: $probe"
}
if (($probe | Out-String).Trim() -ine $MiniPcHost) {
  throw "SSH target mismatch: expected=$MiniPcHost actual=$(($probe | Out-String).Trim())"
}

Write-Output "notebook satellite ready: $repo -> $MiniPcHost"
