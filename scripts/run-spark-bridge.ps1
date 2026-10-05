$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs\spark-driver'
New-Item -ItemType Directory -Force -Path $logDir -ErrorAction Stop | Out-Null
& node.exe (Join-Path $repo 'node_modules\tsx\dist\cli.mjs') (Join-Path $repo 'scripts\spark-bridge.ts') >> (Join-Path $logDir 'bridge.log') 2>&1
exit $LASTEXITCODE
