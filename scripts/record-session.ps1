# katazuku 1会議ぶんの録画セッション(opener から切り離して起動される常駐ヘルパー)
# openerが会議URLを開いた瞬間に本スクリプトを起動する。本スクリプトは:
#   1. 会議の開始時刻ちょうどまで待つ
#   2. 会議アプリを前面化して Game Bar 録画ON(record-toggle)
#   3. 会議の終了時刻まで待つ
#   4. 録画OFF -> 直近mp4を interview-digest.ps1 へ渡して議事録+示唆を生成
# ポーリングは一切しない。1会議=1プロセスで開始→終了まで生きる。
# 使い方: powershell -File record-session.ps1 -Url <会議URL> -StartTime "yyyy-MM-dd HH:mm" -EndTime "yyyy-MM-dd HH:mm" [-Title 件名] [-DryRun]

param(
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$StartTime,
  [string]$EndTime,
  [string]$Title = '(無題)',
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$repo = Split-Path $PSScriptRoot -Parent
$logDir = Join-Path $repo 'logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory $logDir | Out-Null }
$log = Join-Path $logDir 'meeting-record.log'
$lockFile = Join-Path $logDir 'recording.lock'
$recordToggle = Join-Path $PSScriptRoot 'record-toggle.ps1'
$digest = Join-Path $PSScriptRoot 'interview-digest.ps1'
$captures = Join-Path $env:USERPROFILE 'Videos\Captures'

function Log($m) { ("{0} [rec] {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $m) | Out-File -FilePath $log -Append -Encoding utf8 }
function Toggle-Record { & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $recordToggle | Out-Null }

# 指定時刻まで待つ(1回あたり最大60秒スリープの分割待ち)
function Wait-Until([datetime]$dt) {
  while ($true) {
    $rem = ($dt - (Get-Date)).TotalSeconds
    if ($rem -le 0) { break }
    Start-Sleep -Seconds ([int][math]::Min(60, [math]::Ceiling($rem)))
  }
}

# --- 会議ウィンドウの特定と前面化 ---------------------------------------------------------------
# Game Bar は「前面ウィンドウのアプリの音声」+マイクだけを録る(システム音声全体ではない)。
# ここで会議ウィンドウを掴み損ねると、相手の声が1音も入らない録画ができあがる。実例(2026-07-16):
#   - ジャフコ面接: Chrome の Zoom 起動ページ(「Join from Zoom Workplace app」)を掴んだ。会議本体は
#     Zoom デスクトップアプリ側だったため相手の声が全滅し、マイクの自分の声だけが残った。
#   - PKSHA面接: 無関係な YouTube の Chrome ウィンドウを掴んだが、Meet も同じ Chrome だったため音声だけは助かった。
# 旧実装は Get-Process のプロセス名だけで選び、タイトルを見ずに Select-Object -First 1 していたのが原因。
# 対策: 可視ウィンドウをタイトルで走査し、会議ウィンドウそのものを掴む。Zoom はアプリ起動を待つ。
Add-Type @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class WinFind {
  delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowTextW(IntPtr hWnd, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  [DllImport("user32.dll")] static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
  // 可視ウィンドウを "ハンドル<TAB>タイトル" の改行区切りで返す。絞り込みは呼び出し側(PowerShell)で行う。
  public static string ListAll() {
    StringBuilder outp = new StringBuilder();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (!IsWindowVisible(h)) return true;
      StringBuilder sb = new StringBuilder(512);
      GetWindowTextW(h, sb, sb.Capacity);
      string t = sb.ToString();
      if (t.Length > 0) outp.Append(h.ToInt64() + "\t" + t + "\n");
      return true;
    }, IntPtr.Zero);
    return outp.ToString();
  }
  public static void Focus(IntPtr h) {
    // SetForegroundWindow はフォアグラウンドロックで無視されることがある。ALT を空打ちしてロックを外す定番回避。
    keybd_event(0x12, 0, 0, UIntPtr.Zero);
    keybd_event(0x12, 0, 2, UIntPtr.Zero);
    ShowWindow(h, 9); // SW_RESTORE
    SetForegroundWindow(h);
  }
}
'@

function Get-VisibleWindows {
  ([WinFind]::ListAll() -split "`n") | Where-Object { $_ -match "`t" } | ForEach-Object {
    $p = $_ -split "`t", 2
    [pscustomobject]@{ Handle = [IntPtr][int64]$p[0]; Title = $p[1] }
  }
}

# 会議URLから、会議ウィンドウのタイトルに現れるはずの文字列を作る
function Get-MeetingTitlePatterns([string]$u) {
  # Zoom は会議本体がデスクトップアプリで開く。ブラウザ側の「起動ページ」を掴んではいけないので
  # 会議中ウィンドウのタイトル("Zoom Meeting" 系)だけを狙う。
  if ($u -match 'zoom') { return @('Zoom Meeting', 'Zoom ミーティング', 'ズーム ミーティング') }
  if ($u -match 'teams') { return @('Teams') }
  # Meet は Chrome のウィンドウタイトルに会議コードが入る(例: 'Meet - qyf-zqtv-yfi - Google Chrome')
  if ($u -match 'meet\.google\.com/([a-z]{3}-[a-z]{4}-[a-z]{3})') { return @(('Meet - ' + $Matches[1]), $Matches[1]) }
  if ($u -match 'meet\.google\.com') { return @('Meet - ') }
  return @('Meet - ', 'Zoom Meeting', 'Teams')
}

# 会議ウィンドウが現れるまで待って前面化する。Zoom アプリは起動〜入室に時間がかかるため待つ。
function Focus-Meeting([string]$u, [int]$TimeoutSec = 90) {
  $pats = Get-MeetingTitlePatterns $u
  $isZoom = ($u -match 'zoom')
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ($true) {
    $wins = Get-VisibleWindows
    foreach ($pat in $pats) {
      $w = $wins | Where-Object {
             $_.Title -like ('*' + $pat + '*') -and
             # Zoom狙いのときにブラウザの起動ページ/案内ページを誤って掴まない
             -not ($isZoom -and ($_.Title -like '*Google Chrome*' -or $_.Title -like '*Microsoft*Edge*' -or $_.Title -like '*Firefox*'))
           } | Select-Object -First 1
      if ($w) {
        [WinFind]::Focus($w.Handle)
        Start-Sleep -Seconds 2
        Log ("会議ウィンドウを前面化: '{0}'" -f $w.Title)
        return $true
      }
    }
    if ((Get-Date) -ge $deadline) { break }
    Start-Sleep -Seconds 3
  }
  Log ("!! 会議ウィンドウを特定できず(patterns: {0})。このまま録画すると相手の声が入らない恐れ。可視ウィンドウ一覧: {1}" -f `
       ($pats -join ' / '), ((Get-VisibleWindows | ForEach-Object { $_.Title }) -join ' | '))
  return $false
}

# --- 開始/終了時刻の決定(不正時は now / +60分 でフォールバック) ---
$start = $null; try { if ($StartTime) { $start = [datetime]::Parse($StartTime) } } catch {}
$end = $null;   try { if ($EndTime)   { $end   = [datetime]::Parse($EndTime) } } catch {}
if (-not $start) { $start = Get-Date }
if (-not $end -or $end -le $start) { $end = $start.AddMinutes(60) }

Log ("セッション起動: {0} [{1}-{2}] {3}" -f $Title, $start.ToString('HH:mm'), $end.ToString('HH:mm'), $Url)

# すでに終了時刻を過ぎているなら何もしない
if ((Get-Date) -ge $end) { Log '起動時点で終了済み。何もしない'; return }

# 開始時刻まで待つ
Wait-Until $start

# 二重録画防止: 既に別セッションが録画中ならスキップ(重なる会議のGame Bar競合を避ける)
if (Test-Path $lockFile) {
  $lockAge = ((Get-Date) - (Get-Item $lockFile).LastWriteTime).TotalMinutes
  if ($lockAge -lt 180) { Log ("別の録画が進行中({0:N0}分経過)のためスキップ: {1}" -f $lockAge, $Title); return }
  Log '古いロックを検出。奪取して続行'
}
Set-Content -Path $lockFile -Value ("{0}|{1}" -f $Title, $Url) -Encoding utf8

if (-not (Focus-Meeting $Url)) {
  # 掴めなくても録画自体はする(マイクだけでも残ったほうがマシ)。ただしログに残して後から気づけるようにする。
  Log '警告: 会議ウィンドウ未特定のまま録画に進む。相手の声が入らない録画になる可能性が高い'
}

if ($DryRun) {
  Log ("DRYRUN: ここで録画ONするはず({0})" -f $Title)
} else {
  Toggle-Record
  Log ("録画ON: {0}" -f $Title)
}

# 終了時刻まで待つ
Wait-Until $end

if ($DryRun) {
  Log ("DRYRUN: ここで録画OFF+議事録キックするはず({0})" -f $Title)
  Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
  return
}

Toggle-Record
Log ("録画OFF: {0}" -f $Title)
Start-Sleep -Seconds 6   # mp4 書き出し完了待ち

$mp4 = $null
if (Test-Path $captures) {
  $mp4 = Get-ChildItem $captures -Filter *.mp4 -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -ge $start.AddMinutes(-1) } |
    Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($mp4) {
  Log ("議事録生成をキック: {0}" -f $mp4.FullName)
  Start-Process powershell.exe -WindowStyle Hidden -ArgumentList @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $digest),
    '-InputPath', ('"{0}"' -f $mp4.FullName))
} else {
  Log 'Captures に対象 mp4 が見つからず、議事録をキックできない'
}
Remove-Item $lockFile -Force -ErrorAction SilentlyContinue
