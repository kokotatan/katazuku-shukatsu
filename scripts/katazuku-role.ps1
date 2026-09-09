# ノートPCの通常衛星モードと、期限付き緊急正本モードを一か所で判定する。
# リースが壊れている、期限切れ、別端末向けの場合は必ず replica に倒す。

function Get-KatazukuEmergencyCanonicalState {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)

  $path = Join-Path $RepositoryRoot '.katazuku-emergency-canonical.local.json'
  if (-not (Test-Path -LiteralPath $path)) {
    return [pscustomobject]@{ Active = $false; Reason = 'lease_missing'; Path = $path; Lease = $null }
  }
  try {
    $lease = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return [pscustomobject]@{ Active = $false; Reason = 'lease_invalid_json'; Path = $path; Lease = $null }
  }
  if ($lease.schemaVersion -ne 1 -or $lease.status -ne 'active') {
    return [pscustomobject]@{ Active = $false; Reason = ('lease_' + [string]$lease.status); Path = $path; Lease = $lease }
  }
  if (-not $lease.host -or ([string]$lease.host -ine [Environment]::MachineName)) {
    return [pscustomobject]@{ Active = $false; Reason = 'lease_host_mismatch'; Path = $path; Lease = $lease }
  }
  try {
    $leaseExpiry = [DateTimeOffset]::Parse([string]$lease.leaseExpiresAt)
    $hardExpiry = [DateTimeOffset]::Parse([string]$lease.hardExpiresAt)
  } catch {
    return [pscustomobject]@{ Active = $false; Reason = 'lease_date_invalid'; Path = $path; Lease = $lease }
  }
  $now = [DateTimeOffset]::Now
  if ($leaseExpiry -le $now) {
    return [pscustomobject]@{ Active = $false; Reason = 'lease_expired'; Path = $path; Lease = $lease }
  }
  if ($hardExpiry -le $now) {
    return [pscustomobject]@{ Active = $false; Reason = 'hard_expired'; Path = $path; Lease = $lease }
  }
  foreach ($required in @('failoverId', 'canonicalHost', 'sourceDatabaseId', 'sourcePath', 'activatedAt')) {
    if (-not $lease.$required) {
      return [pscustomobject]@{ Active = $false; Reason = 'lease_fields_missing'; Path = $path; Lease = $lease }
    }
  }
  return [pscustomobject]@{ Active = $true; Reason = 'active'; Path = $path; Lease = $lease }
}

function Get-KatazukuOperationalRole {
  param([Parameter(Mandatory = $true)][string]$RepositoryRoot)
  if (-not (Test-Path -LiteralPath (Join-Path $RepositoryRoot '.katazuku-satellite'))) { return 'canonical' }
  $state = Get-KatazukuEmergencyCanonicalState -RepositoryRoot $RepositoryRoot
  if ($state.Active) { return 'canonical' }
  return 'replica'
}
