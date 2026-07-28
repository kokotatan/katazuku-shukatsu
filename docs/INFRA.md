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
- 日次バックアップ: `logs/db-backup`、14日保持

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
| katazuku-watchdog | 08:35〜20:35、4時間ごと | `run-watchdog.vbs` |

`katazuku-watchdog` は番犬(AI非依存の純PowerShell)。活動ログの by別最終実行時刻と
provider-health を監視し、定常タスクの停止・Claude/Codex両方の枠切れを検知したときだけ
トースト+`logs/alert-daily-sync.txt` 追記(asaが翌朝メールで報告)。正常時は無音。
状態は `logs/watchdog-last.local.json`。期待周期を変えたら `scripts/watchdog.ps1` の表も直す。

登録スクリプトは `scripts/register-*.ps1`。タスク登録はOS側権限が必要。
旧 `katazuku-meeting-opener` はmeeting-autopilotと二重起動するため無効化する。

**この表は実態と一致していること。2026-07-24に台帳と実態のずれが原因で事故が起きた**:
`katazuku-calendar-sync` は表に載っていたが**実際には未登録**で、7/19以降カレンダーが
DBのappointmentへ同期されていなかった。meeting-autopilotはDBの予定しか見ないため、
7/23のリンクアイ面談は自動オープンも自動録画もされなかった。台帳を直したら実機も確認する。

**全タスクにバッテリー起動を許可すること**(`-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`)。
`New-ScheduledTaskSettingsSet` の既定は「バッテリー駆動なら起動しない/切替時に停止」で、
電源を外した瞬間に**無言で全自動処理が止まる**。2026-07-24に全タスクで発覚し解除済み。
あわせて現行タスクは `LogonType=Interactive` のため**本人がログオン中のセッションでしか走らない**
(MiniPCへ移す場合は自動ログオンが前提。詳細は `docs/specs/15-minipc-migration.md`)。

## アプリのローカル保存

正本データのlocalStorageキーは廃止。各アプリが保存してよいのは
`katazuku/read-key`（閲覧用合言葉）だけ。
