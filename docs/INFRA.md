# katazuku 既存リソース台帳(重複作成を防ぐための一次情報)

**このファイルの目的**: 新しくクラウドリソース・外部サービス・定常運用の仕組みを作る前に、**必ずここを見て「既にあるものを再利用」する**。
過去に、既存のGCPプロジェクトに気づかず新規プロジェクトを重複作成した失敗がある(2026-07-13)。それを二度と起こさないための台帳。
**新しくインフラ/リソース/定常運用を追加・変更したら、必ずここに追記すること**(古い記述は直す)。

最終更新: 2026-07-13

## Google Cloud
- **プロジェクトは `katazuku` 1つだけを使う。新規プロジェクトを作らない。**(careerアカウント / 組織なし / 2026-07-03頃作成)
  - 有効化済みAPI: **Sheets / Drive / Calendar / Gmail**
  - **サービスアカウント: `katazuku-sync@katazuku.iam.gserviceaccount.com`**(2026-07-13作成、選考管理シート書込用。鍵は `status/service-account.json`)
  - 参考: 空プロジェクト `katazuku-sync` を一度誤作成した(不要・削除可。SA本体は `katazuku` 内にある)
- OAuth: claude.ai直結コネクタ + 自前 workspace-mcp(いずれも career アカウント)

## Google Sheets
- **選考管理シート ID: `1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM`**(「選考管理シート_奥山彪太郎（katazuku同期用）」= career所有。2026-07-13に旧・他人テンプレのコピー `1X6z04…` から自分所有へ複製・切替。旧IDは使わない)
  - 書込ルールは `status/src/lib/sheet.ts` に集約(合格/不合格/辞退は上書きしない・メモ/数式列に触れない)
  - SA `katazuku-sync@…` を**編集者**で共有しておくことが前提

## Windows タスクスケジューラ(このPC / 登録は scripts/register-*.ps1)
| タスク | 起動 | 実体 |
|---|---|---|
| katazuku-mail-watch | 毎時07:15-22:15 + WakeToRun(+ログオンは要管理者再登録) | scripts/mail-watch.ps1 |
| katazuku-meeting-opener | 5分おき | scripts/open-meeting-urls.ps1(Meet/Zoom/Teamsを12分前に自動オープン・Haiku。開いた会議ごとに scripts/record-session.ps1 を切り離し起動し、開始時刻ちょうどにGame Bar録画→終了で interview-digest.ps1 議事録化) |
| katazuku-daily-sync | 毎朝08:23 | scripts/daily-sync.ps1 |
| katazuku-asa | 毎朝09:00 | scripts/katazuku.ps1 asa(対話ウィンドウ) |
| (未スケジュール) reconcile-calendar | 手動/オンデマンド | scripts/reconcile-calendar.ps1(選考管理（新）→careerカレンダーの色・参加予定を整合。落選=グレー/参加確定=トマト/抜け登録/衝突検出。**既定はDryRun=報告のみ、書き込みは -Apply**。個人カレンダーは読むだけ・削除しない。prompt=reconcile-calendar-prompt.md) |

## MCP / コネクタ(career アカウント okuyama.kotaro.career@gmail.com)
- google-workspace(uvx workspace-mcp)/ claude.ai Gmail・Calendar・Drive / playwright / voicebox(音声I/O・文字起こし)

## デプロイ / ホスティング
- 本番: **katazuku.kotalabo.com**(Vercel アカウント=kokotatan + Cloudflare CNAME)
- Vercel Functions: `api/generate-reply`(※ Vercelに ANTHROPIC_API_KEY 未設定=AI返信はテンプレfallback)

## データDB(spec08 / DB中心・**未プロビジョニング**)
- 正データDBを新設予定(spec08)。**まだ作っていない**。作るときは **kokotatan の Vercel Marketplace(Neon Postgres 想定)** に1つだけ。重複作成しないこと。
- スキーマは `db/schema.sql`(company/selection/interview_note/person/es_snippet)。DB作成後 `psql "$DATABASE_URL" -f db/schema.sql` で適用。
- 接続情報は Vercel の env(`DATABASE_URL` 等)+ ローカルは gitignore 済み `.env`。設定ファイルへ平文直書き禁止。
- 認証読取API(`api/`)・初期移行(Sheet→DB)・DB→Sheetミラーは、DB作成後に実装+実地検証する。

## クラウドルーチン(claude.ai/code/routines・リポジトリ外)
- 見張りルーチン(cron `7 0,12 * * *` JST 09:07/21:07、Haiku、Gmailラベル `katazuku-notified` で重複防止)

## アプリ間連携の localStorage キー
- `katazuku-inbox/emails` / `katazuku-pipeline/companies` / `katazuku-pipeline/seeded`(別アプリのキーを書くときは非破壊マージ)

## Gmail ラベル / フィルタ
- ユーザーラベル: `katazuku-notified`(クラウド見張りの重複防止)、`宣伝`(2026-07-13作成・宣伝隔離用。フィルタ適用は本人承認待ち)
