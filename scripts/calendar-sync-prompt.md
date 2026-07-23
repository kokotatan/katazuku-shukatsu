Google Calendarを正本DBのappointmentへ同期してください。

前提:
- 正本は data/katazuku.db。カレンダーは入力であり、予定の正はDBです。
- 対象は今日から過去7日〜未来60日の就活関連予定だけです。私用予定は書きません。
- 利用可能な mcp__claude_ai_Google_Calendar__* または Google Workspace Calendar系ツールを使います。利用不能なら完了行を出さず終了します。

手順:
1. 対象期間の予定を取得する。面接、面談、説明会、就活イベント、選考テスト、提出締切を対象にする。
2. 各予定を次の形式へ正規化し、sync/calendar-import-loop.jsonへJSONで書く:
   {"events":[{
     "externalId":"カレンダー側の不変ID",
     "calendarId":"カレンダーID",
     "title":"予定名",
     "startAt":"ISO 8601",
     "endAt":"ISO 8601",
     "company":"既存DBと照合できる企業名",
     "position":"分かる場合のみ",
     "kind":"面接|面談|説明会|テスト|締切|その他",
     "url":"会議URL(Meet/Zoom/Teams、または weburl.jp・bit.ly・tinyurl.com・x.gd・cutt.ly・is.gd・t.co・lnkd.in・ur0.cc・urx.nu・buff.ly・rebrand.ly 等の短縮リンクも会議URLとして拾う)",
     "location":"場所",
     "status":"予定|中止",
     "attendees":[{"name":"氏名","role":"分かる場合"}]
   }]}
   externalId、title、startAt、companyは必須です。終了時刻・会議URL・参加者を可能な限り取得します。事実を推測しません。
   会議URLは location だけでなく description(説明欄)からも拾う。上記の短縮リンク(例 https://weburl.jp/xxx)しか無い場合も、それを url に入れる(実ブラウザで開けばMeet等へリダイレクトされる)。
3. cd sync; npx tsx scripts/db-apply-calendar.ts calendar-import-loop.json を実行する。
4. npx tsx scripts/db-snapshot.ts を実行する。
5. scripts/log-activity.ps1 で By=calendar-sync、Action=カレンダー予定のDB同期、Why=会議自動運転の予定を最新にするため、How=追加/更新/変化なし件数、Result=成功として1行残す。
6. 結果件数を簡潔に出力し、最終行に単独で === calendar-sync DONE === と出力する。
