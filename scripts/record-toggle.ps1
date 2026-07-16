# record-toggle: toggle Windows Game Bar recording by sending the Win+Alt+R chord.
# Game Bar must be enabled with mic ON (Win+G -> settings).
#
# IMPORTANT (verified 2026-07-16): Game Bar binds to the FOREGROUND window at the moment this fires,
# and records THAT APP's audio + the mic -- NOT all system audio. If the meeting runs in a different
# app than the captured window, the other party's voice is lost entirely and only your mic survives.
#   - JAFCO interview: captured the Chrome "Join from Zoom Workplace app" launch page while the meeting
#     itself ran in the Zoom desktop app -> zero audio from the interviewer.
#   - PKSHA interview: captured an unrelated YouTube Chrome window, but Meet ran in that same Chrome,
#     so the interview audio survived by luck.
# => The meeting window itself must be in front when this fires. scripts\record-session.ps1 does this
#    by matching the window TITLE (and waits for the Zoom app's meeting window to appear).
# Running it once starts recording; running it again stops it.
# Recordings land in %USERPROFILE%\Videos\Captures\*.mp4 -> feed to scripts\interview-digest.ps1.
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class Kbd {
  [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, UIntPtr dwExtraInfo);
}
'@
$KEYDOWN = 0x0
$KEYUP   = 0x2
$VK_WIN = 0x5B  # left Windows key
$VK_ALT = 0x12  # Alt
$VK_R   = 0x52  # R
# press Win+Alt+R
[Kbd]::keybd_event([byte]$VK_WIN, 0, $KEYDOWN, [UIntPtr]::Zero)
[Kbd]::keybd_event([byte]$VK_ALT, 0, $KEYDOWN, [UIntPtr]::Zero)
[Kbd]::keybd_event([byte]$VK_R,   0, $KEYDOWN, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 120
# release in reverse
[Kbd]::keybd_event([byte]$VK_R,   0, $KEYUP, [UIntPtr]::Zero)
[Kbd]::keybd_event([byte]$VK_ALT, 0, $KEYUP, [UIntPtr]::Zero)
[Kbd]::keybd_event([byte]$VK_WIN, 0, $KEYUP, [UIntPtr]::Zero)
"sent Win+Alt+R (Game Bar record toggle)"
