# 自動録音の開始前に予定の種類と長さを確認する。DB更新・録音開始などの副作用は持たない。
function Get-AutomaticRecordingExclusionReason {
  param([Parameter(Mandatory = $true)][object]$Meeting)

  if ($Meeting.recordable -is [bool] -and -not $Meeting.recordable) { return '録音しない指定' }
  if ($Meeting.status -and $Meeting.status -notin @('予定', 'scheduled')) { return '実施予定ではない' }
  $title = [string]$Meeting.title
  $content = [string]$Meeting.kind + ' ' + $title
  if ($content -match '宿泊|チェックイン|チェックアウト|ホテル予約') { return '宿泊関連の予定' }
  if ($content -match 'インターン|internship' -and $title -notmatch '面接|面談|説明会|セミナー') { return 'インターン参加予定' }
  if ($Meeting.attendanceMode -eq 'in_person' -or ($title + ' ' + $Meeting.location) -match '対面|オフライン|来社|訪問|現地') { return '対面の予定' }
  $meetingUri = $null
  if (-not [Uri]::TryCreate([string]$Meeting.url, [UriKind]::Absolute, [ref]$meetingUri)) { return '会議URLが不明' }
  if ($meetingUri.Scheme -ne 'https' -or $meetingUri.UserInfo -or $meetingUri.AbsolutePath -eq '/') { return 'オンライン会議URLではない' }
  $meetingHost = $meetingUri.DnsSafeHost.ToLowerInvariant()
  $recognizedHost = @('meet.google.com', 'zoom.us', 'teams.microsoft.com') | Where-Object {
    $meetingHost -eq $_ -or $meetingHost.EndsWith('.' + $_)
  }
  if (-not $recognizedHost) { return 'オンライン会議URLを確認できない' }

  $startText = [string]$Meeting.startIso
  $endText = [string]$Meeting.endIso
  if ($startText -notmatch '[T ]\d{2}:\d{2}' -or ($endText -and $endText -notmatch '[T ]\d{2}:\d{2}')) {
    return '開始・終了の時刻が明示されていない'
  }
  $start = [DateTimeOffset]::MinValue
  $end = [DateTimeOffset]::MinValue
  $culture = [Globalization.CultureInfo]::InvariantCulture
  $style = [Globalization.DateTimeStyles]::None
  if (-not [DateTimeOffset]::TryParse($startText, $culture, $style, [ref]$start)) {
    return '開始・終了日時が不正'
  }
  if (-not $endText) { $end = $start.AddHours(1) }
  elseif (-not [DateTimeOffset]::TryParse($endText, $culture, $style, [ref]$end)) { return '開始・終了日時が不正' }
  if ($end -le $start) { return '終了日時が開始日時以前' }
  # 誤分類された終日・複数日の予定も開始前に除外する。
  if (($end - $start).TotalHours -ge 24) { return '24時間以上の終日・複数日予定' }

  return $null
}
