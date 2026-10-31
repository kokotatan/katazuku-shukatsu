param([Parameter(Mandatory = $true)][string]$CredentialPath)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

$record = Get-Content -LiteralPath $CredentialPath -Raw -Encoding UTF8 | ConvertFrom-Json
if ($record.version -ne 1 -or $record.portalId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$') { throw '資格情報レコードが不正です。' }

$entropySource = "katazuku-local-login-v1|$($record.portalId)|$($record.allowedOrigin)"
$sha = [System.Security.Cryptography.SHA256]::Create()
$entropy = $sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($entropySource))
$sha.Dispose()

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

$username = $null
$passwordPlain = $null
try {
  $username = Unprotect-Text $record.usernameCiphertext $entropy
  $passwordPlain = Unprotect-Text $record.passwordCiphertext $entropy
  [pscustomobject]@{ username = $username; password = $passwordPlain } | ConvertTo-Json -Compress
}
finally {
  $username = $null
  $passwordPlain = $null
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
}
