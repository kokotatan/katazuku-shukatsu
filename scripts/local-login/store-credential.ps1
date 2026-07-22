param(
  [Parameter(Mandatory = $true)][string]$PortalId,
  [Parameter(Mandatory = $true)][string]$AllowedOrigin,
  [Parameter(Mandatory = $true)][string]$OutputPath,
  [switch]$Fixture
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if ($PortalId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$') { throw 'PortalIdが不正です。' }

$originUri = [Uri]$AllowedOrigin
$isLoopbackFixture = $Fixture -and $originUri.Scheme -eq 'http' -and @('127.0.0.1', 'localhost') -contains $originUri.Host
if ($originUri.AbsolutePath -ne '/' -or $originUri.Query -or $originUri.Fragment -or ($originUri.Scheme -ne 'https' -and -not $isLoopbackFixture)) {
  throw 'AllowedOriginはパスを含まないHTTPS originで指定してください。'
}
$normalizedOrigin = $originUri.GetLeftPart([UriPartial]::Authority)

function Protect-Text([string]$PlainText, [byte[]]$Entropy) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($PlainText)
  try {
    $encrypted = [System.Security.Cryptography.ProtectedData]::Protect($bytes, $Entropy, [System.Security.Cryptography.DataProtectionScope]::CurrentUser)
    return [Convert]::ToBase64String($encrypted)
  }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

$entropySource = "katazuku-local-login-v1|$PortalId|$normalizedOrigin"
$sha = [System.Security.Cryptography.SHA256]::Create()
$entropy = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($entropySource))
$sha.Dispose()

if ($Fixture) {
  $username = 'fixture-user@example.test'
  $passwordPlain = 'fixture-password-42'
}
else {
  $username = Read-Host 'ログインIDまたはメールアドレス'
  $passwordSecure = Read-Host 'パスワード' -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($passwordSecure)
  try { $passwordPlain = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer) }
}

try {
  $record = [ordered]@{
    version = 1
    portalId = $PortalId
    allowedOrigin = $normalizedOrigin
    usernameCiphertext = Protect-Text $username $entropy
    passwordCiphertext = Protect-Text $passwordPlain $entropy
    protectedFor = 'CurrentUser'
    createdAt = [DateTimeOffset]::Now.ToString('o')
  }
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $record | ConvertTo-Json | Set-Content -LiteralPath $OutputPath -Encoding UTF8
  [pscustomobject]@{ status = 'stored'; portalId = $PortalId; allowedOrigin = $normalizedOrigin } | ConvertTo-Json -Compress
}
finally {
  $username = $null
  $passwordPlain = $null
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
}
