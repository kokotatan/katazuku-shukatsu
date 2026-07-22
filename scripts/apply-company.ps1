param(
  [Parameter(Mandatory = $true, Position = 0)][ValidateNotNullOrEmpty()][string] $Company,
  [string] $Position = '',
  [string] $Season = '28卒本選考',
  [ValidateSet('auto', 'codex', 'claude', 'codex-oss')][string] $Agent = 'auto',
  [switch] $PromptOnly
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
$materialsRef = Join-Path $repo 'chrome-prompts\submit.local.md'
if (-not (Test-Path -LiteralPath $materialsRef)) {
  throw "個人情報と完成済みESの台帳がありません: $materialsRef"
}

$normalized = (($Company.Trim().Normalize([Text.NormalizationForm]::FormKC)) + '|' + $Position.Trim() + '|' + $Season).ToLowerInvariant()
$sha = [Security.Cryptography.SHA256]::Create()
try {
  $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($normalized))).Replace('-', '').ToLowerInvariant()
} finally {
  $sha.Dispose()
}
$sourceRef = "application:${Season}:$($digest.Substring(0, 16))"

$logDir = Join-Path $repo 'logs\applications'
if (-not (Test-Path -LiteralPath $logDir)) {
  New-Item -ItemType Directory -Path $logDir | Out-Null
}
$safe = $Company -replace '[\\/:*?"<>|]', '-'
$promptFile = Join-Path $logDir ("{0}-{1}.local.md" -f (Get-Date -Format 'yyyyMMdd-HHmmss'), $safe)
$basePrompt = Get-Content -Raw -Encoding UTF8 -Path (Join-Path $PSScriptRoot 'application-company-prompt.md')
$prompt = @"
$basePrompt

今回の実行値:
- COMPANY: $Company
- POSITION: $Position
- SEASON: $Season
- SOURCE_REF: $sourceRef
- MATERIALS_REF: $materialsRef
- REPOSITORY: $repo
"@
Set-Content -LiteralPath $promptFile -Value $prompt -Encoding UTF8

if ($PromptOnly) {
  $prompt | Set-Clipboard
  Write-Output "応募自動運転の指示をクリップボードへコピーしました: $Company"
  Write-Output "保存先: $promptFile"
  exit 0
}

Write-Output "応募自動運転を開始します: $Company (agent: $Agent)"
Write-Output "最終送信、本人認証、適性検査の受検、選択肢が曖昧な場合だけ確認を求めます。"
$invokeAgent = Join-Path $PSScriptRoot 'invoke-agent.ps1'
$invokeArgs = @{
  Workflow = 'application-company'
  RunId = $sourceRef
  PromptFile = $promptFile
  Risk = 'external-commit'
  SideEffectMode = 'direct'
  Agent = $Agent
  Capability = @('workspace.read', 'workspace.write', 'shell', 'web.search', 'browser.interact')
}
& $invokeAgent @invokeArgs

Write-Output "応募自動運転のセッションを終了しました: $Company"
