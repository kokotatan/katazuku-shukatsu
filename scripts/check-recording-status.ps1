# マイクを開かずに、誤表示につながる境界と実際のプロセス照会を確認する。
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib-recording-status.ps1')
$script:checks = 0
function Check([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
  $script:checks++
  Write-Output ('OK: ' + $message)
}
$root = Split-Path $PSScriptRoot -Parent
$recordings = Join-Path $root 'logs\interviews'
$output = Join-Path $recordings '確認用 音声.wav'
$at = [datetime]::UtcNow
$process = [pscustomobject]@{ Name = 'ffmpeg.exe'; ProcessId = 4123; CreationDate = $at; CommandLine = ('"C:\Program Files\ffmpeg.exe" -f dshow -i audio=@device_abc -t 60 "{0}"' -f $output) }
$capture = ConvertTo-KatazukuCapture $process @($recordings)
Check ($capture.Path -eq $output) '空白と日本語を含む録音パスを検出できる'
Check ($capture.SessionId -match '^[a-f0-9]{64}$') '録音の識別子から会議名や保存パスを出さない'
Check ((Get-KatazukuRecordingSessionId ($output -replace '\.wav$', '.part2.wav')) -eq $capture.SessionId) '見張りの録り直しを新しい録音と扱わない'
Check ((Get-KatazukuRecordingSessionId (Join-Path $recordings '次の録音.wav')) -ne $capture.SessionId) '次の録音は別の識別子になる'
$process.CommandLine = 'ffmpeg.exe -i "' + $output + '" -c copy "' + $output + '"'
Check ($null -eq (ConvertTo-KatazukuCapture $process @($recordings))) '音声の変換や結合は録音として表示しない'
$process.CommandLine = 'ffmpeg.exe -f dshow -i audio=@device_abc "' + (Join-Path ($recordings + '-other') 'other.wav') + '"'
Check ($null -eq (ConvertTo-KatazukuCapture $process @($recordings))) '名前が似た別フォルダーの録音を取り込まない'
$process.CommandLine = 'ffmpeg.exe -f lavfi -i anullsrc "' + $output + '"'
Check ($null -eq (ConvertTo-KatazukuCapture $process @($recordings))) 'テスト音の生成を録音として表示しない'
$history = @{}
$empty = Resolve-KatazukuRecordingStatus -Observations @() -History $history -Now $at
Check ($empty.State -eq 'stopped') '録音プロセスがなければ停止中になる'
$sample = [pscustomobject]@{ Capture = $capture; Bytes = 0L }
$first = Resolve-KatazukuRecordingStatus @($sample) $history $at
Check ($first.State -eq 'starting') 'プロセスの存在だけでは録音中にならない'
$sample.Bytes = 44L
$header = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(2)
Check ($header.State -eq 'starting') 'WAVヘッダーだけの生成を音声保存と扱わない'
$sample.Bytes = 262144L
$recorded = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(4)
Check ($recorded.State -eq 'recording' -and $recorded.ElapsedSeconds -eq 4) '音声データの増加を確認して録音中と経過時間を表示する'
Check ($recorded.SessionIds.Count -eq 1 -and $recorded.SessionIds[0] -eq $capture.SessionId) '現在の録音の識別子を表示側へ渡す'
$buffered = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(12)
Check ($buffered.State -eq 'recording') '通常の書き込みバッファー待ちでは異常表示しない'
$stalled = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(20)
Check ($stalled.State -eq 'stalled') 'プロセスが残っていても保存停止を見つける'
$sample.Bytes = 524288L
$recovered = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(22)
Check ($recovered.State -eq 'recording') '書き込みが復帰すれば録音中へ戻る'
$stopped = Resolve-KatazukuRecordingStatus -Observations @() -History $history -Now $at.AddSeconds(23)
Check ($stopped.State -eq 'stopped' -and $history.Count -eq 0) 'プロセス終了時に録音中表示と履歴が消える'
$restart = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(24)
Check ($restart.State -eq 'starting') '同じPID・ファイルでも終了後は再度書き込みを確かめる'
$sample.Bytes = 0L
$truncated = Resolve-KatazukuRecordingStatus @($sample) $history $at.AddSeconds(25)
Check ($truncated.State -eq 'starting') 'ファイルが短くなった場合に過去の書き込みを流用しない'
# CIM取得失敗と参照権限不足を安全側へ倒す。モックはこの検証プロセスだけに存在する。
function Get-CimInstance { throw '検証用の取得失敗' }
$unknown = Get-KatazukuRecordingStatus -RepositoryRoot $root -History @{}
Check ($unknown.State -eq 'unknown') 'プロセスの確認失敗を停止中と誤表示しない'
function Get-CimInstance { [pscustomobject]@{ Name = 'ffmpeg.exe'; CommandLine = $null } }
$hidden = Get-KatazukuRecordingStatus -RepositoryRoot $root -History @{}
Check ($hidden.State -eq 'unknown') '参照できない録音候補があれば状態不明を表示する'
Remove-Item Function:\Get-CimInstance
$live = Get-KatazukuRecordingStatus -RepositoryRoot $root -History @{}
Check ($live.State -in @('stopped', 'starting', 'recording', 'stalled', 'unknown')) 'このPCのプロセスを読み取って有効な状態を返す'
Write-Output ('録音表示: {0}項目の検証に成功' -f $script:checks)
