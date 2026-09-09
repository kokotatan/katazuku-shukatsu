$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-recording-eligibility.ps1')
$fixturePath = Join-Path (Split-Path $PSScriptRoot -Parent) 'sync/fixtures/recording-eligibility.json'
$fixture = Get-Content -LiteralPath $fixturePath -Raw -Encoding UTF8 | ConvertFrom-Json
foreach ($case in $fixture.cases) {
  $candidate = @{}
  foreach ($property in $fixture.base.PSObject.Properties) { $candidate[$property.Name] = $property.Value }
  foreach ($property in $case.meeting.PSObject.Properties) { $candidate[$property.Name] = $property.Value }
  $candidate['startIso'] = $candidate['startAt']
  $candidate['endIso'] = $candidate['endAt']
  $reason = Get-AutomaticRecordingExclusionReason -Meeting ([pscustomobject]$candidate)
  $eligible = [string]::IsNullOrEmpty($reason)
  if ($eligible -ne $case.eligible) { throw ('FAIL: {0} / {1}' -f $case.name, $reason) }
  Write-Output ('PASS: {0}' -f $case.name)
}
Write-Output ('自動録音の対象判定: {0}件成功' -f $fixture.cases.Count)