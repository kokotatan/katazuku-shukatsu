# 正本DB(company.login_id / company.password)の平文資格情報を、DPAPI暗号化レコードへ移行する。
#
# 設計上の約束:
# - 平文はこのプロセスのメモリ内だけを通る。標準出力・ログ・例外・コマンドライン引数には一切出さない。
# - 出力するのは portalId / origin / 許可URLプレフィックス / 成否 だけ。
# - エントロピー導出は store-credential.ps1 と同一("katazuku-local-login-v1|<portalId>|<origin>")。
#   許可URLプレフィックスは秘密ではないのでレコードの平文フィールドとして持つ(エントロピーには含めない)。
# - DBの平文は既定では消さない。-ClearDbPassword を付けたときだけ、復号検証に成功した企業のみ消す。
#
# 使い方:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-login\migrate-db-credentials.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-login\migrate-db-credentials.ps1 -ClearDbPassword

param(
  [switch]$ClearDbPassword,
  [string]$OutputDir = '',
  [ValidateRange(1, 2147483647)][int]$CompanyId = 0
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
if (-not $OutputDir) { $OutputDir = Join-Path $repo 'credential-store' }
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Protect-Text([string]$PlainText, [byte[]]$Entropy) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($PlainText)
  try {
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $Entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($encrypted)
  }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Unprotect-Text([string]$Ciphertext, [byte[]]$Entropy) {
  $encrypted = [Convert]::FromBase64String($Ciphertext)
  $plainBytes = $null
  try {
    $plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect($encrypted, $Entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Text.Encoding]::UTF8.GetString($plainBytes)
  }
  finally {
    if ($encrypted) { [Array]::Clear($encrypted, 0, $encrypted.Length) }
    if ($plainBytes) { [Array]::Clear($plainBytes, 0, $plainBytes.Length) }
  }
}

# mypage_url から origin と 許可URLプレフィックス(ディレクトリ境界まで)を導出する。
# クエリはテナント識別に使われることがあるが、プレフィックス照合には含められないので落とす。
function Get-Scope([string]$Url) {
  $uri = [Uri]$Url
  if ($uri.Scheme -ne 'https') { throw 'HTTPSではないURL' }
  $origin = $uri.GetLeftPart([UriPartial]::Authority)
  $path = $uri.AbsolutePath
  if (-not $path.EndsWith('/')) { $path = $path.Substring(0, $path.LastIndexOf('/') + 1) }
  $prefix = if ($path -eq '/') { '' } else { "$origin$path" }
  return [pscustomobject]@{ Origin = $origin; Prefix = $prefix; HadQuery = [bool]$uri.Query }
}

# 平文を含むJSONを変数で受ける(ファイルに落とさない)
$reader = Join-Path $PSScriptRoot 'read-db-credentials.mjs'
$priorCompanyId = $env:KATAZUKU_COMPANY_ID
try {
  if ($CompanyId) { $env:KATAZUKU_COMPANY_ID = [string]$CompanyId }
  else { Remove-Item Env:KATAZUKU_COMPANY_ID -ErrorAction SilentlyContinue }
  $json = & node $reader
}
finally {
  if ($null -eq $priorCompanyId) { Remove-Item Env:KATAZUKU_COMPANY_ID -ErrorAction SilentlyContinue }
  else { $env:KATAZUKU_COMPANY_ID = $priorCompanyId }
}
if ($LASTEXITCODE -ne 0 -or -not $json) { throw 'DBから移行対象を読み出せませんでした。' }
$entries = $json | ConvertFrom-Json
if ($CompanyId -and @($entries).Count -eq 0) { throw "company.id=$CompanyId に移行可能な資格情報がありません。" }

$migrated = @()
foreach ($entry in $entries) {
  $portalId = $entry.portalId
  $result = [ordered]@{ portalId = $portalId; company = $entry.name; status = ''; origin = ''; prefix = ''; note = '' }
  try {
    $scope = Get-Scope $entry.mypageUrl
    $result.origin = $scope.Origin
    $result.prefix = $scope.Prefix
    if ($scope.HadQuery) { $result.note = 'URLのクエリは適用範囲に含められない(テナント識別がクエリ側なら要確認)' }
    if (-not $entry.username) { throw 'login_idが空' }

    $entropySource = "katazuku-local-login-v1|$portalId|$($scope.Origin)"
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $entropy = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($entropySource))
    $sha.Dispose()

    $record = [ordered]@{
      version = 1
      portalId = $portalId
      allowedOrigin = $scope.Origin
      allowedPathPrefix = $scope.Prefix
      usernameCiphertext = Protect-Text $entry.username $entropy
      passwordCiphertext = Protect-Text $entry.password $entropy
      protectedFor = 'CurrentUser'
      createdAt = [DateTimeOffset]::Now.ToString('o')
      migratedFrom = 'db:company'
    }
    $outPath = Join-Path $OutputDir "$portalId.json"
    $record | ConvertTo-Json | Set-Content -LiteralPath $outPath -Encoding UTF8

    # 復号検証(値は表示せず、往復一致だけ確認する)
    $roundTripUser = Unprotect-Text $record.usernameCiphertext $entropy
    $roundTripPass = Unprotect-Text $record.passwordCiphertext $entropy
    $okUser = $roundTripUser -ceq [string]$entry.username
    $okPass = $roundTripPass -ceq [string]$entry.password
    $roundTripUser = $null; $roundTripPass = $null
    if (-not ($okUser -and $okPass)) { throw '復号検証に失敗' }

    $result.status = 'migrated'
    $migrated += $entry.companyId
    if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
  }
  catch {
    $result.status = 'skipped'
    # 例外メッセージに秘密値が混ざらないよう、種別だけを残す
    $result.note = ($result.note + ' ' + $_.Exception.Message).Trim()
  }
  [pscustomobject]$result
}

# 後片付け(平文をメモリから落とす)
$entries = $null
$json = $null
[System.GC]::Collect()

if ($ClearDbPassword -and $migrated.Count -gt 0) {
  $ids = ($migrated -join ',')
  $clearScript = "import { DatabaseSync } from 'node:sqlite';" +
    "const db = new DatabaseSync(process.env.KATAZUKU_DB ?? 'data/katazuku.db');" +
    "db.exec(`UPDATE company SET password = '' WHERE id IN ($ids)`);" +
    "db.close();"
  Push-Location $repo
  try { & node --input-type=module -e $clearScript } finally { Pop-Location }
  Write-Output "DBの平文パスワードを削除しました(company.id: $ids)"
}
else {
  Write-Output 'DBの平文は残しています(削除するには -ClearDbPassword を付けて再実行)'
}
