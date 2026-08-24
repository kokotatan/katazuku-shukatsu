[CmdletBinding(SupportsShouldProcess = $true)]
param(
  [ValidateRange(5, 10080)][int]$OlderThanMinutes = 1440,
  [switch]$IncludeManagedBridge,
  [switch]$Apply
)

$ErrorActionPreference = 'Stop'
$cutoff = (Get-Date).AddMinutes(-$OlderThanMinutes)
$all = @(Get-CimInstance Win32_Process)
$byId = @{}
foreach ($process in $all) { $byId[[int]$process.ProcessId] = $process }

# Treat only uvx processes that started workspace-mcp directly as roots.
# The current node -> workspace-mcp-bridge -> uvx topology cleans itself up.
$targets = @($all | Where-Object {
  $_.Name -eq 'uvx.exe' -and
  $_.CommandLine -match '(?i)(^|\s|[\\/])workspace-mcp(?:\.exe)?(\s|$)' -and
  $_.CreationDate -lt $cutoff -and
  ($IncludeManagedBridge -or -not $byId.ContainsKey([int]$_.ParentProcessId) -or $byId[[int]$_.ParentProcessId].Name -ne 'node.exe')
} | Sort-Object CreationDate, ProcessId)

$result = [ordered]@{
  checkedAt = (Get-Date).ToString('o')
  cutoff = $cutoff.ToString('o')
  apply = [bool]$Apply
  includeManagedBridge = [bool]$IncludeManagedBridge
  targets = @()
  stopped = @()
}

foreach ($target in $targets) {
  $parent = if ($byId.ContainsKey([int]$target.ParentProcessId)) { $byId[[int]$target.ParentProcessId] } else { $null }
  $item = [ordered]@{
    pid = [int]$target.ProcessId
    startedAt = ([datetime]$target.CreationDate).ToString('o')
    parentPid = [int]$target.ParentProcessId
    parentName = if ($parent) { $parent.Name } else { '<exited>' }
  }
  $result.targets += $item
  if (-not $Apply) { continue }
  if ($PSCmdlet.ShouldProcess("PID $($target.ProcessId)", 'Stop stale workspace-mcp process tree')) {
    & taskkill.exe /PID $target.ProcessId /T /F 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $result.stopped += [int]$target.ProcessId }
  }
}

$result | ConvertTo-Json -Depth 5
