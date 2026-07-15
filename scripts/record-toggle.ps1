# record-toggle: toggle Windows Game Bar recording by sending the Win+Alt+R chord.
# Game Bar must be enabled and set to capture system audio + mic (Win+G -> settings).
# Game Bar records the currently FOREGROUND app window, so the meeting window must be in front
# when this fires. Running it once starts recording; running it again stops it.
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
