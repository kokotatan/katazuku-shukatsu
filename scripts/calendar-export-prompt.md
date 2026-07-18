# DB予定をカレンダーへ反映する

目的: appointment を正本として、まだ外部カレンダーIDがない予定を本人のカレンダーへ冪等に作成する。

## 手順

1. cd sync && npx tsx scripts/db-calendar-outbox.ts を実行する
2. appointments が空なら何もしない
3. 各予定を本人の就活用カレンダーへ作成する
   - タイトル: 【就活】会社名 予定タイトル
   - 開始・終了: at / endAt。endAt が空なら面接・面談は60分、締切は時刻どおり
   - 場所: location
   - 説明: 職種、種別、相手、URL、DBのappointmentId
   - オンラインURLは説明にも残す
4. 作成結果を links 配列に appointmentId、externalId、calendarId を持つ一時JSONにする
5. cd sync && npx tsx scripts/db-link-calendar.ts 一時JSON を実行する
6. DBへ書いたので cd sync && npx tsx scripts/db-snapshot.ts を実行する
7. scripts/log-activity.ps1 に作成件数、目的、方法、結果を1行残す

## 制約

- 同じ appointmentId を二重作成しない
- カレンダー作成に失敗した項目はlinkしない
- 日時やURLを推測しない
- 外部カレンダーに既存の同一予定がある場合はそれを再利用し、そのIDをlinkする
- キャンセルや変更はDB側の根拠を確認してから扱う
