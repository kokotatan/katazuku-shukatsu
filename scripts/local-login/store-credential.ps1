param(
  [Parameter(Mandatory = $true)][string]$PortalId,
  # 専用ホストのポータル用。パスを含まないorigin(例 https://login.example.com)
  [string]$AllowedOrigin = '',
  # 共有ATS(1ホストに複数企業が同居)用。ログインページの完全URLを渡すと
  # origin + テナントパスまでを適用範囲として記録する(例 https://ats.example.com/tenant-a/mypage/login)
  [string]$AllowedUrl = '',
  [Parameter(Mandatory = $true)][string]$OutputPath,
  # agent/別プロセスから標準入力で「ID改行、パスワード改行」を渡す非対話経路。
  # 秘密値をコマンドライン引数や環境変数へ載せないために使う。
  [switch]$ReadFromStdin,
  [switch]$Fixture
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Security
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)

if ($PortalId -notmatch '^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$') { throw 'PortalIdが不正です。' }

if (-not $AllowedOrigin -and -not $AllowedUrl) { throw 'AllowedOrigin か AllowedUrl のどちらかを指定してください。' }
if ($AllowedOrigin -and $AllowedUrl) { throw 'AllowedOrigin と AllowedUrl は同時に指定できません。' }

$allowedPathPrefix = ''
if ($AllowedUrl) {
  # 共有ATS向け: ログインページURLから origin + テナントパス(ディレクトリ境界まで)を導出する
  $urlUri = [Uri]$AllowedUrl
  $isLoopbackFixture = $Fixture -and $urlUri.Scheme -eq 'http' -and @('127.0.0.1', 'localhost') -contains $urlUri.Host
  if ($urlUri.UserInfo -or $urlUri.Query -or $urlUri.Fragment -or ($urlUri.Scheme -ne 'https' -and -not $isLoopbackFixture)) {
    throw 'AllowedUrlはクエリ・フラグメントを含まないHTTPS URLで指定してください。'
  }
  $normalizedOrigin = $urlUri.GetLeftPart([UriPartial]::Authority)
  $path = $urlUri.AbsolutePath
  if (-not $path.EndsWith('/')) { $path = $path.Substring(0, $path.LastIndexOf('/') + 1) }
  $allowedPathPrefix = "$normalizedOrigin$path"
}
else {
  $originUri = [Uri]$AllowedOrigin
  $isLoopbackFixture = $Fixture -and $originUri.Scheme -eq 'http' -and @('127.0.0.1', 'localhost') -contains $originUri.Host
  if ($originUri.UserInfo -or $originUri.AbsolutePath -ne '/' -or $originUri.Query -or $originUri.Fragment -or ($originUri.Scheme -ne 'https' -and -not $isLoopbackFixture)) {
    throw 'AllowedOriginはパスを含まないHTTPS originで指定してください。'
  }
  $normalizedOrigin = $originUri.GetLeftPart([UriPartial]::Authority)
}

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
  $username = 'fixture-user@example.com'
  $passwordPlain = 'fixture-password-42'
}
elseif ($ReadFromStdin) {
  $username = [Console]::In.ReadLine()
  $passwordPlain = [Console]::In.ReadLine()
  if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrEmpty($passwordPlain)) {
    throw '標準入力のログインIDまたはパスワードが空です。'
  }
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
    # 共有ATSでの取り違え防止。専用ホストなら空文字(=origin一致のみ)。秘密ではないので平文で持つ。
    allowedPathPrefix = $allowedPathPrefix
    usernameCiphertext = Protect-Text $username $entropy
    passwordCiphertext = Protect-Text $passwordPlain $entropy
    protectedFor = 'CurrentUser'
    createdAt = [DateTimeOffset]::Now.ToString('o')
  }
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $temporaryPath = "$OutputPath.$([Guid]::NewGuid().ToString('N')).tmp"
  try {
    $record | ConvertTo-Json | Set-Content -LiteralPath $temporaryPath -Encoding UTF8
    Move-Item -LiteralPath $temporaryPath -Destination $OutputPath -Force
  }
  finally { if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force } }
  [pscustomobject]@{ status = 'stored'; portalId = $PortalId; allowedOrigin = $normalizedOrigin } | ConvertTo-Json -Compress
}
finally {
  $username = $null
  $passwordPlain = $null
  if ($entropy) { [Array]::Clear($entropy, 0, $entropy.Length) }
}
