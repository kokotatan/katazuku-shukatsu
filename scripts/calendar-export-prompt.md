# DBの予定をカレンダーへ反映する(DB → Google Calendar)

目的: 正本DBの appointment を正として、まだ外部カレンダーIDが無い予定を本人のカレンダーへ冪等に作成する。

## 手順

1. `npx tsx scripts/db-calendar-outbox.ts` を実行する。`appointments` が空なら何もしない。
2. 各予定を主アカウント({{PRIMARY_ACCOUNT}})のカレンダーへ作成する。
   - タイトル: 【就活】会社名 予定タイトル
   - **開始・終了は時刻入り**(終日にしない)。endAt が空なら面接・面談は60分、締切は時刻どおり。
   - `flexible=true` は固定予定ではない本人タスク。他の予定と重なる場合、同じ日の 09:00〜20:00 を15分刻みで確認し、
     最も早い空き15分へ移す。作成前なら `npx tsx scripts/db-appointment.ts move <appointmentId> <開始ISO> <終了ISO>`
     でDBを先に更新し、outbox を取り直す。flexible の予定は availability=FREE(予定ありにしない)で作る。
   - 説明: 職種・種別・相手・URL・DBの appointmentId。オンラインURLは location と説明の両方に入れる。
3. **重複を作らない**: 作成前に `get_events` で同日同件名を確認し、既存の同一予定があればそれを再利用してそのIDをリンクする。
4. 作成・再利用できたものだけ `{"links":[{"appointmentId","externalId","calendarId"}]}` を
   `logs/calendar-links.local.json` に書き、`npx tsx scripts/db-link-calendar.ts logs/calendar-links.local.json` を実行する。
5. 作成に失敗した予定はリンクしない(次回の outbox に残る)。日時やURLを推測しない。
