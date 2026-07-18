# katazuku 既存リソース台帳

重複作成を防ぐための一次情報。新しいクラウド資源や定常タスクを作る前に必ず確認する。

最終更新: 2026-07-18

## 正本DBと配信

- 正本: `data/katazuku.db`（ローカルSQLite / node:sqlite / gitignore）
- スナップショット: `data/snapshot.json`（gitignore）を `api/push.ts` からVercel Private Blobの `snapshot.json` へ上書き
- 読取: `api/data.ts?key=...`。環境変数 `KATAZUKU_READ_SECRET`
- 書込認証: `KATAZUKU_WRITE_SECRET`。ローカルはrepo直下 `.env`
- 人物・証明写真: `data/private/photos` → `photo-sync.ts` → Private Blob `private-photos/*`
  - 配信は `api/photo.ts`、投入は `api/photo-push.ts`
  - 写真本体はDB、snapshot、gitに入れない
- 日次バックアップ: `data/backups`、14日保持

Neon/Postgresは使っていない。新設しない。

## Vercel / ドメイン

- 本番: `katazuku.kotalabo.com`
- ホスティング: Vercel（Cloudflare CNAME）
- Functions: `api/data`、`api/push`、`api/photo`、`api/photo-push`
- Blobはprivate。署名なしURLを公開しない

## Google

- GCPプロジェクト: `katazuku` 1つだけ
- careerアカウント: `okuyama.kotaro.career@gmail.com`
- コネクタ: claude.ai Gmail / Google Calendar / Drive、workspace-mcp
- 選考管理シート: `1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM`
  - ミラー先: 「選考管理（新）」「企業マスタ（新）」
  - 正本ではない。人は直接編集しない
- 活動ログ: シート「活動ログ」+ `logs/activity-log.jsonl`

## Windows定常タスク

| タスク | 起動 | 実体 |
|---|---:|---|
| katazuku-mail-watch | 07:15〜22:15、1時間ごと | `run-mail-watch.vbs` |
| katazuku-daily-sync | 08:23 | `run-daily-sync.vbs` |
| katazuku-asa | 09:00 | `run-asa.vbs` |
| katazuku-calendar-sync | 30分ごと | `run-calendar-sync.vbs` |
| katazuku-meeting-autopilot | 5分ごと | `meeting-autopilot.ps1` |

登録スクリプトは `scripts/register-*.ps1`。タスク登録はOS側権限が必要。
旧 `katazuku-meeting-opener` はmeeting-autopilotと二重起動するため無効化する。

## アプリのローカル保存

正本データのlocalStorageキーは廃止。各アプリが保存してよいのは
`katazuku/read-key`（閲覧用合言葉）だけ。
