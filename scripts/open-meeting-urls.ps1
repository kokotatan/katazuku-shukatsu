# 旧タスクからの互換入口。自動起動・録音の対象判定をmeeting-autopilotへ統一する。
# カレンダーのURLだけを見てインターンや説明会を録音する旧経路は使わない。
& (Join-Path $PSScriptRoot 'meeting-autopilot.ps1')