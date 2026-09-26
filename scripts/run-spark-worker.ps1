$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs\spark-driver'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
& node.exe (Join-Path $repo 'node_modules\tsx\dist\cli.mjs') (Join-Path $repo 'scripts\spark-worker.ts') >> (Join-Path $logDir 'worker.log') 2>&1
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
