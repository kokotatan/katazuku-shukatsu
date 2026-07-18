# katazuku-shukatsu

就活を自動運転する個人エージェント基盤。ユーザーは開発者本人ただ一人。
ルーチンをDBへ集約し、本人は「考える・受ける・認証する・決める」に集中する。

## アーキテクチャ

`data/katazuku.db`（SQLite、gitignore）が唯一の正本です。書き手はagentだけです。

- 入力: メール、本人との会話、面接録音、提出結果、Google Calendar、企業研究
- 配信: `db-snapshot.ts` → 認証付きVercel Blob → 8アプリが `/api/data` を読む
- 写真: DB・snapshot・gitには入れず、Private Blobを `/api/photo` 経由で読む
- ミラー: `db-mirror.ts` → Google Sheets。シートは閲覧とバックアップ用
- 監査: 自律処理は `logs/activity-log.jsonl` とシート「活動ログ」へ記録

## アプリ

`inbox`、`status`、`insight`、`profile`、`people`、`prep`、`impact`、`board` は残しています。
各アプリはSmartHR Design Systemの見た目を維持し、localStorageを正本にせず、共通パッケージ
`@katazuku/data` からDBスナップショットを読みます。localStorageに残すのは閲覧用合言葉だけです。

## 主な自動運転

- `daily-sync.ps1`: Gmail → 選考・正規化メール・提出結果 → DB → snapshot → シート
- `calendar-sync.ps1`: Google Calendar → appointmentをexternalId/hashで冪等upsert
- `meeting-autopilot.ps1`: 予定10分前にURL、5分後に録音、meeting_run状態機械で一回限り実行
- `interview-digest.ps1`: 音声 → Whisper → 厳格JSON → 面接・人物・人物メモ・プロフィール候補
- `research-company.ps1`: 一次情報中心の企業研究 → company_dossier
- `db-merge-tracks.ts`: 重複した選考トラックを関連レコードごと統合
- `application-autopilot.ps1`: エントリー、完成済みES転記、本人承認後の提出、適性検査準備、面接予定を1つのrunで追跡
- `db-calendar-outbox.ts`: DBで確定した面接・締切を外部カレンダーへ冪等に反映するための送信待ち一覧

応募自動運転の設計は `docs/specs/11-application-autopilot.md`、将来の公開範囲と準備は
`docs/oss-roadmap.md` にまとめています。

DBを書いたら必ず次を実行します。

`cd sync && npx tsx scripts/db-snapshot.ts`

## 検証

`cd sync && npx tsx scripts/check-db.ts`

`cd sync && npx tsx scripts/check-sheet.ts`

`cd sync && npx tsx scripts/check-application.ts`

`npm run build`

機密情報、`.env`、`data/`、`logs/`、`*.local.md` はコミットしません。
