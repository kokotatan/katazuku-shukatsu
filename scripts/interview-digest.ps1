# interview-digest: turn an interview recording into structured notes + forward-looking insights.
#
# Pipeline: (video/audio file) -> [ffmpeg extract audio if needed] -> 30秒チャンク分割
#           -> voicebox-transcribe.ts が決定的に全文文字起こし(ローカルWhisper・MCP直叩き)
#           -> 共通agent runnerが話者ラベル付け・議事録構造化・今後への示唆を書く。
# 音声処理はローカル。Claude制限中はCodexへ引き継ぐ。
# 文字起こしをLLMのMCP呼び出しにやらせない理由(2026-07-29): codex execは非対話でMCPツール
# 呼び出しを「user cancelled」で自動拒否するため、フォールバック時に議事録が丸ごと止まった。
#
# Recording the call (both sides) on Windows: use the built-in Game Bar (Win+Alt+R) on the
# meeting window. In Game Bar settings set "Audio to record = All" and mic ON so the other
# party's voice (system audio) and yours (mic) are both captured. It saves an .mp4 to
# %USERPROFILE%\Videos\Captures. Pass that .mp4 here; audio is extracted automatically.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts\interview-digest.ps1 -InputPath "C:\...\recording.mp4"
param(
  [Parameter(Mandatory = $true)]
  [Alias('AudioPath')]
  [string]$InputPath,
  [int]$AppointmentId = 0,
  # 既定では議事録が取れたら中間ファイル(チャンク)と巨大な元録画を消してディスクを節約する。
  # 元動画を残したいときだけ -KeepSource を付ける。聞き直し用の16kHz wavと文字起こしtxtは常に残る。
  [switch]$KeepSource,
  # note-pc(録音担当機)用: 正本DBはminipcにあるため、文字起こし・構造化はこのマシンで行い、
  # 成果物(db.json/文字起こし/顔写真)をminipcへ転送してDB反映だけ向こうで実行する(2026-08-14)。
  # 前提: ssh minipc が鍵で通ること。移行後のリポジトリ名を優先し、旧名にも自動フォールバックする。
  [switch]$RemoteApply
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo

# 衛星機マーカー: このマシンの data/katazuku.db は正本ではない(正本はminipc)。
# マーカーファイルがあれば、明示指定がなくてもDB反映はminipcへ送る(record-audio経由の自動呼出しを含む)。
if (-not $RemoteApply -and (Test-Path (Join-Path $repo '.katazuku-satellite'))) { $RemoteApply = $true }

if (-not (Test-Path $InputPath)) { Write-Error "input file not found: $InputPath"; exit 1 }
$InputPath = (Resolve-Path $InputPath).Path

$logDir = Join-Path $repo 'logs'
$intDir = Join-Path $logDir 'interviews'
foreach ($d in @($logDir, $intDir)) { if (-not (Test-Path $d)) { New-Item -ItemType Directory $d | Out-Null } }
$logFile = Join-Path $logDir ("interview-digest-{0}.log" -f (Get-Date -Format 'yyyy-MM-dd_HHmm'))

# 想定外の致命的エラーで痕跡ゼロのまま死なない(隠しウィンドウ起動のため標準エラーは失われる)。
# 実害 2026-07-29: EAP=Stop下で npx の stderr 1行が NativeCommandError になり、文字起こし直後に無言死した。
trap {
  ('[FATAL] {0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_) | Out-File -FilePath $logFile -Append -Encoding utf8
  if ($_.ScriptStackTrace) { $_.ScriptStackTrace | Out-File -FilePath $logFile -Append -Encoding utf8 }
  # 面接の議事録が失われても無音にしない。asa が alert-*.txt を拾って翌朝報告する(#5修正)。
  ("{0} interview-digest 失敗: {1} (詳細: logs/{2})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $_, (Split-Path $logFile -Leaf)) |
    Out-File -FilePath (Join-Path $logDir 'alert-interview.txt') -Append -Encoding utf8
  exit 1
}

# Locate ffmpeg (PATH may not be refreshed yet after a winget install, so also check the WinGet Links shim).
# Needed both to extract audio from video and to split audio into Whisper-sized chunks.
$ffmpeg = (Get-Command ffmpeg -ErrorAction SilentlyContinue).Source
if (-not $ffmpeg) {
  $cand = @("$env:LOCALAPPDATA\Microsoft\WinGet\Links\ffmpeg.exe") +
          (Get-ChildItem "$env:LOCALAPPDATA\Microsoft\WinGet\Packages" -Recurse -Filter ffmpeg.exe -ErrorAction SilentlyContinue | ForEach-Object FullName)
  $ffmpeg = $cand | Where-Object { Test-Path $_ } | Select-Object -First 1
}
if (-not $ffmpeg) { Write-Error "need ffmpeg. Install: winget install Gyan.FFmpeg"; exit 1 }

# voicebox must already be listening BEFORE the agent starts: each provider binds its MCP servers at
# launch, so starting voicebox afterwards does not give that session the transcribe tool. Without this
# check the run fails silently in its worst form -- chunking "succeeds", every transcribe call is a
# no-op, and no transcript is ever written (hit 2026-07-15 and again 2026-07-16; see PROGRESS.md).
$voiceboxPort = 17493
function Test-Voicebox { try { (New-Object Net.Sockets.TcpClient).Connect('127.0.0.1', $voiceboxPort); return $true } catch { return $false } }
if (-not (Test-Voicebox)) {
  $vb = @("$env:ProgramFiles\Voicebox\voicebox.exe", "${env:ProgramFiles(x86)}\Voicebox\voicebox.exe") |
    Where-Object { Test-Path $_ } | Select-Object -First 1
  if (-not $vb) { Write-Error "voicebox is not running and voicebox.exe was not found. Start Voicebox, then re-run."; exit 1 }
  "voicebox is down. starting $vb ..."
  Start-Process $vb -WindowStyle Minimized
  $deadline = (Get-Date).AddSeconds(60)
  while (-not (Test-Voicebox) -and (Get-Date) -lt $deadline) { Start-Sleep -Seconds 2 }
  if (-not (Test-Voicebox)) { Write-Error "voicebox did not open port $voiceboxPort within 60s. Start it manually, then re-run."; exit 1 }
  "voicebox is up (port $voiceboxPort)"
}

# voicebox accepts these audio formats directly; anything else (mp4/mkv/mov...) is extracted first.
$audioExts = @('.wav', '.mp3', '.m4a', '.webm', '.opus', '.flac')
$ext = [System.IO.Path]::GetExtension($InputPath).ToLower()
$stem = [System.IO.Path]::GetFileNameWithoutExtension($InputPath)
$audioPath = $InputPath

if ($audioExts -notcontains $ext) {
  $audioPath = Join-Path $intDir ($stem + '.wav')
  # 16 kHz mono wav is ideal for Whisper.
  & $ffmpeg -hide_banner -loglevel error -y -i $InputPath -vn -ac 1 -ar 16000 $audioPath
  if (-not (Test-Path $audioPath)) { Write-Error "ffmpeg failed to extract audio"; exit 1 }
}

# Voicebox decodes only Whisper's first 30-second window per request, and reports the FULL duration
# while doing so, so a whole recording silently transcribes to just its opening 30 seconds with no error.
# Verified 2026-07-15: a 60s and a 300s clip from the same offset returned byte-identical text.
# Split into 30s chunks; the prompt transcribes each in order and concatenates.
$chunkDir = Join-Path $intDir ($stem + '-chunks')
if (Test-Path $chunkDir) { Remove-Item $chunkDir -Recurse -Force }
New-Item -ItemType Directory $chunkDir | Out-Null
& $ffmpeg -hide_banner -loglevel error -y -i $audioPath -f segment -segment_time 30 -ac 1 -ar 16000 (Join-Path $chunkDir 'c-%03d.wav')
$chunkCount = (Get-ChildItem $chunkDir -Filter 'c-*.wav').Count
if ($chunkCount -eq 0) { Write-Error "ffmpeg produced no chunks from $audioPath"; exit 1 }
"split into $chunkCount x 30s chunks -> $chunkDir"

# 文字起こしはLLMに任せず、ここで決定的に済ませる(providerが何でも壊れない)。
# 再実行時は既存のrawがあれば再利用する(文字起こしは高くつく処理のため)。
$rawTxt = Join-Path $intDir ($stem + '-raw.txt')
if (-not (Test-Path $rawTxt)) {
  $prevUrl = $env:KATAZUKU_VOICEBOX_MCP_URL
  $env:KATAZUKU_VOICEBOX_MCP_URL = 'http://127.0.0.1:17493/mcp'
  try {
    Push-Location (Join-Path $repo 'sync')
    # EAP=Stopのままnativeコマンドを2>&1でパイプすると、stderrに1行出ただけ(npmの更新通知等)で
    # NativeCommandErrorとして即死する。native実行中だけContinueへ落とし、成否は終了コードと成果物で判定する。
    $ErrorActionPreference = 'Continue'
    npx tsx scripts/voicebox-transcribe.ts $chunkDir $rawTxt 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    $ErrorActionPreference = 'Stop'
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path $rawTxt)) {
      Write-Error "voicebox文字起こしに失敗した。ログ: $logFile"; exit 1
    }
  } finally { Pop-Location; $env:KATAZUKU_VOICEBOX_MCP_URL = $prevUrl; $ErrorActionPreference = 'Stop' }
}
"transcribed -> $rawTxt"

# Feed the base prompt + the (ASCII) transcript marker to the provider-independent runner.
$prompt = Get-Content -Raw (Join-Path $PSScriptRoot 'interview-digest-prompt.md')
$dbJson = Join-Path $intDir ($stem + '-db.json')
$prompt = $prompt + "`n`nTRANSCRIPT_RAW=" + $rawTxt + "`nCHUNK_COUNT=" + $chunkCount + "`nSOURCE_FILE=" + $InputPath + "`nAPPOINTMENT_ID=" + $AppointmentId + "`nDB_JSON=" + $dbJson + "`n"

# providerの診断出力はstderrにも流れるため、この呼出しだけ継続し、下の完了マーカーで成否を判定する。
$prevEAP = $ErrorActionPreference
$previousVoiceboxUrl = $env:KATAZUKU_VOICEBOX_MCP_URL
$ErrorActionPreference = 'Continue'
$env:KATAZUKU_VOICEBOX_MCP_URL = 'http://127.0.0.1:17493/mcp'
$safeStem = $stem -replace '[^a-zA-Z0-9._-]', '-'
$digestRunId = if ($AppointmentId -gt 0) { 'appointment-' + $AppointmentId } else { 'recording-' + $safeStem }
try {
  & (Join-Path $PSScriptRoot 'invoke-agent.ps1') `
    -Workflow 'interview-digest' -RunId $digestRunId -PromptText $prompt `
    -Risk 'db-write' -SideEffectMode 'workspace' `
    -Capability @('workspace.read', 'workspace.write', 'shell') `
    *> $logFile
} finally {
  $env:KATAZUKU_VOICEBOX_MCP_URL = $previousVoiceboxUrl
  $ErrorActionPreference = $prevEAP
}

$ok = (Test-Path $logFile) -and ((Get-Content -Raw $logFile) -match '===\s*interview-digest\s*完了\s*===')
if ($ok) {
  if (-not (Test-Path $dbJson)) {
    Write-Warning "interview-digest FAILED (DB JSONが無い): $dbJson"
    exit 1
  }
  if ($RemoteApply) {
    # --- note-pc → minipc 転送とリモートDB反映(2026-08-14 機体分担) --------------------------------
    # 転送物: db.json / 話者ラベル付き文字起こし(transcriptPathが指す) / スクショ+切出顔写真(-shots)。
    # 文字起こしのファイル名は日本語を含み得るため、scpの文字化けを避けてzip(UTF-8エントリ名)で運ぶ。
    $prevEAPr = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
      $meta = Get-Content -Raw $dbJson -Encoding UTF8 | ConvertFrom-Json
      Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
      $zipName = ('bridge-' + $safeStem + '.zip')
      $zipPath = Join-Path ([System.IO.Path]::GetTempPath()) $zipName
      if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
      $zip = [System.IO.Compression.ZipFile]::Open($zipPath, 'Create')
      try {
        $addFile = {
          param($abs)
          if (-not (Test-Path -LiteralPath $abs)) { return }
          $rel = ([IO.Path]::GetFullPath($abs)).Substring($repo.Length + 1) -replace '\\', '/'
          [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $abs, $rel) | Out-Null
        }
        & $addFile $dbJson
        if ($meta.transcriptPath) {
          $tp = $meta.transcriptPath
          if (-not [IO.Path]::IsPathRooted($tp)) { $tp = Join-Path $repo $tp }
          & $addFile $tp
        }
        # スクショと顔写真(SOURCE_FILEのスラッグ規約: <stem>-shots)。photoPathの絶対パスは両機で同一。
        $shotsDir = Join-Path $intDir ($stem + '-shots')
        # 規約名が一致しないときの救済(2026-08-14の実害): kubellの議事録を手動で回した際、
        # 音声ファイル名の時刻(1200)とショットのフォルダ名(1156)がずれていたため
        # ショットが同梱されず、面接官の顔写真がDBに入らなかった。
        # 見つからなければ、録音時刻の前後2時間に更新された -shots を新しい順で1つ拾う。
        if (-not (Test-Path -LiteralPath $shotsDir)) {
          $srcTime = (Get-Item -LiteralPath $InputPath).LastWriteTime
          $cand = Get-ChildItem -LiteralPath $intDir -Directory -Filter '*-shots' -ErrorAction SilentlyContinue |
            Where-Object { [math]::Abs(($_.LastWriteTime - $srcTime).TotalHours) -le 2 } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
          if ($cand) {
            $shotsDir = $cand.FullName
            ('[shots] 規約名の -shots が無いため、時刻が近いフォルダを使う: {0}' -f $cand.Name) |
              Out-File -FilePath $logFile -Append -Encoding utf8
          }
        }
        if (Test-Path -LiteralPath $shotsDir) {
          Get-ChildItem -LiteralPath $shotsDir -File | ForEach-Object { & $addFile $_.FullName }
        }
      } finally { $zip.Dispose() }

      # minipcも兄弟フォルダ構成へ移行済みなら新名を使う。未移行なら旧名を使い、移行中も処理を止めない。
      $remoteRepoOutput = ssh -o BatchMode=yes minipc 'if exist "%USERPROFILE%\katazuku-shukatsu-private" (echo katazuku-shukatsu-private) else if exist "%USERPROFILE%\katazuku-shukatsu" (echo katazuku-shukatsu) else (exit /b 2)' 2>&1
      $remoteRepoOutput | Out-File -FilePath $logFile -Append -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw 'minipc側のPrivateリポジトリが見つかりません' }
      $remoteRepoName = [string]($remoteRepoOutput | Select-Object -Last 1)
      $remoteRepoName = $remoteRepoName.Trim()
      $remoteRepoPath = '%USERPROFILE%\' + $remoteRepoName

      scp -o BatchMode=yes -q $zipPath ("minipc:$remoteRepoName/logs/" + $zipName) 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw 'minipcへの成果物転送(scp)に失敗しました' }
      Remove-Item $zipPath -Force -ErrorAction SilentlyContinue

      # 展開はWindows標準のtar.exe(bsdtar・zip対応・UTF-8エントリ名対応)。
      # powershellの入れ子クォートはssh越しに壊れるため使わない(2026-08-14実測: バックスラッシュが消える)。
      $expand = 'tar -xf ' + $remoteRepoPath + '\logs\' + $zipName + ' -C ' + $remoteRepoPath + ' && del ' + $remoteRepoPath + '\logs\' + $zipName
      ssh -o BatchMode=yes minipc $expand 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw 'minipc側でのzip展開に失敗しました' }

      if ($AppointmentId -gt 0) {
        # minipc側のmeeting_runは(録音がこの機で完結するため)armedのまま。遷移規則は1段ずつ厳格なので
        # digestingまで寛容に歩かせる。cmdの `&` 連結は途中失敗(既に先へ進んでいる等)でも続行される。
        $walk = 'cd ' + $remoteRepoPath + '\sync && ' +
          "(npx tsx scripts/db-meeting-run.ts transition $AppointmentId opened & " +
          "npx tsx scripts/db-meeting-run.ts transition $AppointmentId recording & " +
          "npx tsx scripts/db-meeting-run.ts transition $AppointmentId stopping & " +
          "npx tsx scripts/db-meeting-run.ts transition $AppointmentId digesting)"
        ssh -o BatchMode=yes minipc $walk 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
      }
      $remoteDbJson = $remoteRepoPath + '\logs\interviews\' + (Split-Path $dbJson -Leaf)
      # db.json のファイル名には空白が入る(例 kubell-kubell 面接 澤井さん(...)-db.json)ので引用符が要るが、
      # PowerShell 5.1 はネイティブexe(ssh)へ渡す引数から素の " を落とす。
      # 2026-08-14の実害: 引用符なしでリモートに届き、cmdが空白で切って 'kubell-kubell' を開こうとし
      # ENOENT でDB反映が丸ごと止まった(文字起こしとdb.json生成は成功済みだった)。
      # \" と書けば ssh の向こうに " として届く(同日 dir で実測: 素の"はC:\Users\okuyaを列挙、\"は当該ファイルに命中)。
      $applyCmd = 'cd ' + $remoteRepoPath + '\sync && ' +
        ('npx tsx scripts/db-apply-interview.ts \"' + $remoteDbJson + '\" && npx tsx scripts/photo-sync.ts && npx tsx scripts/db-snapshot.ts')
      ssh -o BatchMode=yes minipc $applyCmd 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw 'minipc側でのDB反映に失敗しました' }
    } finally { $ErrorActionPreference = $prevEAPr }
  } else {
  try {
    Push-Location (Join-Path $repo 'sync')
    # 上の文字起こしと同じ理由: native 2>&1 パイプの間はEAPをContinueにする(失敗判定は$LASTEXITCODE)
    $ErrorActionPreference = 'Continue'
    if ($AppointmentId -gt 0) {
      npx tsx scripts/db-meeting-run.ts transition $AppointmentId digesting 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
      if ($LASTEXITCODE -ne 0) { throw 'meeting_runをdigestingへ進められませんでした' }
    }
    npx tsx scripts/db-apply-interview.ts $dbJson 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) { throw '面接JSONをDBへ反映できませんでした' }
    # 面談スクショから顔写真が登録された場合(people[].photoPath)に備え、Private Blobへ同期する。
    # secret が無ければ photo-sync 側がスキップする。失敗しても議事録反映は成功扱い(後で再実行できる)。
    npx tsx scripts/photo-sync.ts 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
    if ($LASTEXITCODE -ne 0) { Write-Warning '写真のBlob同期に失敗した(議事録反映は成功。cd sync; npx tsx scripts/photo-sync.ts で再実行できる)' }
    npx tsx scripts/db-snapshot.ts 2>&1 | Out-File -FilePath $logFile -Append -Encoding utf8
  } finally { Pop-Location; $ErrorActionPreference = 'Stop' }
  }
  "interview-digest OK. notes appended to chrome-prompts/interview-notes.local.md (log: logs/$(Split-Path $logFile -Leaf))"

  # 活動ログに「何を/何のために/どうしたか」を1行残す(本人が後から確認できる状態のため)
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'log-activity.ps1') `
    -By 'interview-digest' -Action ("面接の議事録を作成: " + $stem) `
    -Why '録画を後から振り返り、次選考対策・志望動機に反映するため' `
    -How '録音をvoiceboxで文字起こし→議事録化(要確認箇所はタイムスタンプ付きで明示)' `
    -Link 'chrome-prompts/interview-notes.local.md' -Result '成功' | Out-Null

  # --- 掃除(本人方針 2026-07-16): 議事録が取れたら中間ファイルとデカい元録画を消す。 ------------
  # 「議事録取れたら消していい」。ただし議事録は不明瞭箇所を [mm:ss] で聞き直す設計なので、
  # 聞き直し用の 16kHz mono wav($audioPath)と文字起こし txt は必ず残す。消すのは:
  #   ・30秒チャンク($chunkDir、純粋な中間・数百MB)
  #   ・元動画($InputPath が mp4 等で、そこから wav を抽出した場合のみ。数GB)。-KeepSource で残せる。
  # 入力が最初から wav(record-audio.ps1 の出力)なら、それ自体が聞き直し用なので消さない。
  if (Test-Path $chunkDir) {
    Remove-Item $chunkDir -Recurse -Force -ErrorAction SilentlyContinue
    "  cleanup: 中間チャンクを削除 ($chunkDir)"
  }
  if (Test-Path $rawTxt) {
    # 話者ラベル付きの全文が logs/interviews/<企業>-<日付>.txt に保存済みなので、生の中間txtは消す
    Remove-Item $rawTxt -Force -ErrorAction SilentlyContinue
    "  cleanup: 中間の生文字起こしを削除 ($rawTxt)"
  }
  $extractedFromVideo = ($audioPath -ne $InputPath)   # 動画等から wav を別途抽出した場合に true
  if ($extractedFromVideo -and -not $KeepSource -and (Test-Path $InputPath)) {
    $mb = [math]::Round((Get-Item $InputPath).Length / 1MB, 0)
    Remove-Item $InputPath -Force -ErrorAction SilentlyContinue
    "  cleanup: 元録画を削除 (${mb}MB, 聞き直し用wavは保持 -> $audioPath)"
  }
} else {
  # Exit non-zero so a background/scheduled caller sees the failure. Returning 0 here made a failed run
  # look like a completed one (2026-07-16).
  Write-Warning "interview-digest FAILED (no completion marker). See log: logs/$(Split-Path $logFile -Leaf)"
  # 完了マーカー無しの失敗も asa へ上げる(#5修正。この exit はtrapを通らないので直接書く)。
  ("{0} interview-digest 失敗: 完了マーカーなし (詳細: logs/{1})" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), (Split-Path $logFile -Leaf)) |
    Out-File -FilePath (Join-Path $logDir 'alert-interview.txt') -Append -Encoding utf8
  exit 1
}
