# このPCの録音を読み取り専用で確認する。DBの「開始指示済み」は録音の証拠にしない。
function Get-KatazukuRecordingWindowKey([string]$RepositoryRoot) {
  $hash = [Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [Text.Encoding]::UTF8.GetBytes([IO.Path]::GetFullPath($RepositoryRoot).ToLowerInvariant())
    return 'Local\katazuku-recording-display-' + ([BitConverter]::ToString($hash.ComputeHash($bytes))).Replace('-', '').Substring(0, 20)
  } finally { $hash.Dispose() }
}

function ConvertTo-KatazukuCapture {
  param($Process, [string[]]$OutputRoots)
  if ($Process.Name -ine 'ffmpeg.exe' -or -not $Process.CommandLine) { return }
  # コマンドラインを実行しない。引用符付きのパスを含めて引数の境界だけ読む。
  $arguments = @([regex]::Matches($Process.CommandLine, '(?:[^\s"]+|"[^"]*")+') |
    ForEach-Object { $_.Value.Replace('"', '') })
  $isCapture = $false
  for ($index = 0; $index -lt $arguments.Count - 1; $index++) {
    if ($arguments[$index] -eq '-f' -and $arguments[$index + 1] -eq 'dshow') { $isCapture = $true }
  }
  if (-not $isCapture) { return } # 文字起こし用の変換・結合・テスト音の生成を録音と誤認しない。
  foreach ($argument in $arguments) {
    if (-not $argument.EndsWith('.wav', [StringComparison]::OrdinalIgnoreCase)) { continue }
    try {
      $path = [IO.Path]::GetFullPath($argument)
      $isOwnedOutput = $false
      foreach ($root in $OutputRoots) {
        $prefix = [IO.Path]::GetFullPath($root).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
        if ($path.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) { $isOwnedOutput = $true }
      }
      if (-not $isOwnedOutput) { continue }
      $startedAt = ([datetime]$Process.CreationDate).ToUniversalTime()
      return [pscustomobject]@{
        ProcessId = [int]$Process.ProcessId
        StartedAt = $startedAt
        Path = $path
        Key = '{0}:{1}:{2}' -f $Process.ProcessId, $startedAt.Ticks, $path
        SessionId = Get-KatazukuRecordingSessionId $path
      }
    } catch { continue }
  }
}

function Get-KatazukuRecordingSessionId([string]$Path) {
  # 見張りの.partN.wavは同じ録音として扱う。会議名や保存パスは診断情報へ出さない。
  $sessionPath = [IO.Path]::GetFullPath($Path).ToLowerInvariant() -replace '\.part\d+(?=\.wav$)', ''
  $hash = [Security.Cryptography.SHA256]::Create()
  try { return ([BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($sessionPath)))).Replace('-', '').ToLowerInvariant() }
  finally { $hash.Dispose() }
}

function Get-KatazukuRecordingStatus {
  param(
    [Parameter(Mandatory = $true)][string]$RepositoryRoot,
    [Parameter(Mandatory = $true)][hashtable]$History,
    [datetime]$Now = [datetime]::UtcNow,
    [int]$StallSeconds = 15
  )
  try {
    $roots = @((Join-Path $RepositoryRoot 'logs\interviews'), (Join-Path $env:USERPROFILE 'Videos\Captures'))
    $processes = @(Get-CimInstance Win32_Process -Filter "Name='ffmpeg.exe'" -ErrorAction Stop)
    $captures = @($processes | ForEach-Object { ConvertTo-KatazukuCapture -Process $_ -OutputRoots $roots })
    # 参照できないプロセスがあるとき、「停止中」と断言しない。
    if (@($processes | Where-Object { -not $_.CommandLine }).Count -gt 0) { throw '録音プロセスの情報を読み取れません' }
    $observations = @($captures | ForEach-Object {
      $size = 0L
      if (Test-Path -LiteralPath $_.Path) { $size = (Get-Item -LiteralPath $_.Path -ErrorAction Stop).Length }
      [pscustomobject]@{ Capture = $_; Bytes = $size }
    })
    return Resolve-KatazukuRecordingStatus -Observations $observations -History $History -Now $Now -StallSeconds $StallSeconds
  } catch {
    return [pscustomobject]@{ State = 'unknown'; Label = '録音状態を確認できません'; Detail = '状態の取得を再試行しています'; ElapsedSeconds = 0; Count = 0; SessionIds = @(); UpdatedAt = $Now.ToString('o') }
  }
}

function Resolve-KatazukuRecordingStatus {
  param([object[]]$Observations, [hashtable]$History, [datetime]$Now, [int]$StallSeconds = 15)
  $active = @($Observations)
  $keys = @($active | ForEach-Object { $_.Capture.Key })
  foreach ($key in @($History.Keys)) { if ($key -notin $keys) { $History.Remove($key) } }
  $state = 'stopped'; $label = '録音停止中'; $detail = '現在、録音していません'; $elapsed = 0
  if ($active.Count -gt 0) {
    $state = 'recording'; $label = '録音中'; $detail = '音声ファイルを保存しています'
    $starting = $false; $stalled = $false
    foreach ($observation in $active) {
      $capture = $observation.Capture
      if (-not $History.ContainsKey($capture.Key)) {
        $History[$capture.Key] = @{ Bytes = $observation.Bytes; LastGrowth = $Now; Confirmed = $false }
      } else {
        $previous = $History[$capture.Key]
        if ($observation.Bytes -gt $previous.Bytes -and $observation.Bytes -gt 44) {
          $previous.LastGrowth = $Now; $previous.Confirmed = $true
        } elseif ($observation.Bytes -lt $previous.Bytes) {
          $previous.LastGrowth = $Now; $previous.Confirmed = $false
        }
        $previous.Bytes = $observation.Bytes
      }
      $sample = $History[$capture.Key]
      if (($Now - $sample.LastGrowth).TotalSeconds -ge $StallSeconds) { $stalled = $true }
      elseif (-not $sample.Confirmed) { $starting = $true }
      $elapsed = [math]::Max($elapsed, [math]::Max(0, [int]($Now - $capture.StartedAt).TotalSeconds))
    }
    if ($stalled) { $state = 'stalled'; $label = '録音を確認'; $detail = '音声の保存が{0}秒以上止まっています' -f $StallSeconds }
    elseif ($starting) { $state = 'starting'; $label = '録音開始を確認中'; $detail = '音声の書き込みを待っています' }
    if ($active.Count -gt 1) { $detail = ('{0}件の録音 / ' -f $active.Count) + $detail }
  }
  $sessionIds = @($active | ForEach-Object { $_.Capture.SessionId } | Where-Object { $_ } | Sort-Object -Unique)
  return [pscustomobject]@{ State = $state; Label = $label; Detail = $detail; ElapsedSeconds = $elapsed; Count = $active.Count; SessionIds = $sessionIds; UpdatedAt = $Now.ToString('o') }
}
