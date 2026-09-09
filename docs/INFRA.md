# katazuku 既存リソース台帳

重複作成を防ぐための一次情報。新しいクラウド資源や定常タスクを作る前に必ず確認する。

最終更新: 2026-09-08

## 正本DBと配信

- 正本: `data/katazuku.db`（ローカルSQLite / node:sqlite / gitignore）
- スナップショット: `data/snapshot.json`（gitignore）をCloudflare Workerの `/api/push` からPrivate R2の `snapshot.json` へ上書き
- 読取: Workerの `/api/data?key=...`。環境変数 `KATAZUKU_READ_SECRET`
- 書込認証: `KATAZUKU_WRITE_SECRET`。ローカルはrepo直下 `.env`
- 人物・証明写真: `data/private/photos` → `photo-sync.ts` → Private Blob `private-photos/*`
  - 配信は `api/photo.ts`、投入は `api/photo-push.ts`
  - 写真本体はDB、snapshot、gitに入れない
- 日次バックアップ: `logs/db-backup`、14日保持

Neon/Postgresは使っていない。新設しない。

## Vercel / 旧ドメイン

- 旧配信先: `katazuku.kotalabo.com`。2026-09-08の新UIはCloudflareの `katazuku-app.kotalabo.com` へ配置
- ホスティング: Vercel（Cloudflare CNAME）
- Functions: `api/data`、`api/push`、`api/photo`、`api/photo-push`、`api/push-subscribe`、`api/push-send`
- Blobはprivate。署名なしURLを公開しない
  - `snapshot.json`（正本のスナップショット）、`private-photos/*`、`push-subscriptions.json`（Web Push購読・個人データ）

## Cloudflare（私用GUIと公開HPを分離）

- 移行先: Workers Static Assets + Worker API + Private R2 bucket `katazuku-private`
- 構成の正本: `wrangler.jsonc`、Worker実装: `cloudflare/worker.ts`
- `/api/data`、`/api/push`、写真、Web Push、studioのURL互換を維持する
- 2026-08-29にWorker `katazuku-shukatsu`、R2 bucket `katazuku-private`、必要secretを作成・デプロイ済み
- 2026-09-02に `workers.dev` の `/api/push` へのsnapshot書込みと `/api/data` からの読み戻しを実データで確認済み。
  repo直下 `.env` の `KATAZUKU_PUSH_URL` はCloudflare Workerを指す
- 私用GUI: `https://katazuku-app.kotalabo.com`。Worker `katazuku-shukatsu` のcustom domainとして2026-09-08に接続。
  ネクタイロゴと閲覧中心UIを反映し、認証付きデータ・写真200、未認証401を確認。従来のworkers.dev URLも同期先として維持。
- 2026-09-08の本人訂正により、架空データを使う表示例は撤去。8つの閲覧画面は未入力時に見出し・列・行と静止した灰色の線だけを薄く表示し、合言葉入力欄を重ねる。未入力時のAPI通信なし、データ・写真APIの未認証401を維持。version `86c6f976-a0db-4e97-a194-e80d087cedb7` で反映を確認。
- 2026-09-08に活動記録を月のカレンダー・日別記録へ変更。version `4272b864-c383-4573-bb75-6801ce10cce0` で8画面のアセット一致と未認証401を確認。既存snapshotの読取のみで、新しい保存先・会話全文の収集経路は追加していない。
- `katazuku.kotalabo.com` はVercel向けCNAMEが残る。現在のWrangler OAuthにDNS編集権限がなく、既存CNAMEとの競合で切替できなかったため、新しい私用ドメインを採用。旧Vercel deploymentは保持。
- 公開HP: `https://katazuku-shukatsu.kotalabo.com`。別Worker `katazuku-shukatsu-site`、設定は `site/wrangler.jsonc`。
  `site/dist/` の静的HTMLだけを配信し、R2・秘密値・私用データのバインディングは付けない。
- 公開HPは15ページ（紹介・導入・使い方・記事6本・参加方法等）と404。私用GUIのrobotsは全拒否、公開HPはクロール許可とサイトマップを設定。
- Cloudflare側でWeb Analyticsのbeaconが自動挿入される。公開HPのプライバシーページへ記載済み。

## PWA / Web Push（spec16、2026-07-28）

- landing配下: `manifest.webmanifest`（start_urlは書かない。ホーム画面追加時のURL `?key=合言葉` を起動URLにするため）、
  `sw.js`（シェルキャッシュ+Push受信のみ。/api/ はキャッシュしない）、`icons/`（teal「片」PNG。`tools/gen-icon-fallback.ps1` で再生成）
- VAPID鍵: ローカルは `.env`（`KATAZUKU_VAPID_PUBLIC_KEY` / `KATAZUKU_VAPID_PRIVATE_KEY` / `KATAZUKU_VAPID_SUBJECT`）、
  Vercelは production / preview 両環境に登録済み。再生成すると全端末の購読が無効になるので原則再生成しない
- 手動送信: `node scripts/push-send.mjs --body "..."`（認証は `.env` の `KATAZUKU_WRITE_SECRET`）
- 通知本文はロック画面に出るため要約レベル（企業名・個人名を細かく載せない）

## Google

- GCPプロジェクト: `katazuku` 1つだけ
- **対象アカウント(2026-08-17〜 4アカウント)**:
  - career=`okuyama.kotaro.career@gmail.com`(就活の主アカウント。**自動送信を行うのはここだけ**)
  - kotaro=`okuyama.kotaro@gmail.com`(下書き+DB登録のみ)
  - robotics=`okuyama.kotaro.robotics@gmail.com`(下書き+DB登録のみ)
  - p3=`okuyama.kotaro.p3@dc.tohoku.ac.jp`(東北大。下書き+DB登録のみ)
  - workspace-mcp は `~/.claude.json` で `--single-user`(既定 career)だが、4アカウントとも
    OAuth 認証済みでトークンがローカルにキャッシュされているため、ツール呼び出し時に
    `user_google_email` を渡せば4アカウントを扱える。`mail-watch` / `daily-sync` は各アカウントを巡回する
  - 送信ポリシー: 定型・低重要度の就活返信の**自動送信は career のみ**。他3アカウントは常に下書き
  - 受信整理の削除: career は就活媒体を7日でゴミ箱。他3アカウントは**広告・ニュースレターのみ**ゴミ箱
    (就活媒体スカウト・選考関連は既読化のみで残す。本人合意 2026-08-17)
- コネクタ: claude.ai Gmail / Google Calendar / Drive、workspace-mcp
- 選考管理シート: `1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM`
  - ミラー先: 「選考管理（新）」「企業マスタ（新）」
  - 正本ではない。人は直接編集しない
- 活動ログ: シート「活動ログ」+ `logs/activity-log.jsonl`
- **未対応の追い込み(follow-up)**: カレンダー同期(`calendar-sync`)と会議自動起動(`meeting-autopilot`)は
  現状 career カレンダーのみ。他3アカウントのカレンダーを取り込む場合は別途改修が必要(2026-08-17時点で未実施)

## Windows定常タスク

| タスク | 起動 | 実体 |
|---|---:|---|
| katazuku-mail-watch | 07:15〜22:15、1時間ごと | `run-mail-watch.vbs` |
| katazuku-daily-sync | 08:23 | `run-daily-sync.vbs` |
| katazuku-asa | 09:00 | `run-asa.vbs` |
| katazuku-calendar-sync | 30分ごと | `run-calendar-sync.vbs` |
| katazuku-meeting-autopilot | 5分ごと | `meeting-autopilot.ps1` |
| katazuku-watchdog | 08:35〜20:35、4時間ごと | `run-watchdog.vbs` |
| katazuku-evening-brief | 毎晩20:15 | `run-evening-brief.vbs` |

ノートPCの録音状態は、`register-recording-status.ps1` が本人のStartupフォルダーへ登録する
`katazuku-recording-status.lnk` でログイン時に常駐表示する（2026-09-08追加）。実体は
`recording-status.ps1`。録音プロセスと音声ファイルの増加をローカルで確認し、停止中・開始確認中・
録音中・保存停止・状態不明を表示する。録音開始時も `start-recording-status.ps1` で表示を戻す。
多重起動は名前付きMutexで抑止し、録音制御・DB・クラウド同期には依存しない。

`katazuku-watchdog` は番犬(AI非依存の純PowerShell)。活動ログの by別最終実行時刻と
provider-health を監視し、定常タスクの停止・Claude/Codex両方の枠切れを検知したときだけ
トースト+`logs/alert-daily-sync.txt` 追記(asaが翌朝メールで報告)。正常時は無音。
状態は `logs/watchdog-last.local.json`。期待周期を変えたら `scripts/watchdog.ps1` の表も直す。

登録スクリプトは `scripts/register-*.ps1`。タスク登録はOS側権限が必要。
旧 `katazuku-meeting-opener` はmeeting-autopilotと二重起動するため無効化する。

### 自動ログインの端末内設定（2026-09-08）

- 既存タスク `\katazuku-local-login` を再利用する。設定画面を開く際は照会だけを行い、保存操作で時刻・有効状態を更新する。
- ノートPC `OKUYAMA` では停止中・07:40を照会済み。今回の開発・回帰確認では実タスクの状態を変更していない。
- 起動: `scripts/open-local-login-settings.vbs` または `npm run local-login:settings`。
- 画面: `http://127.0.0.1:18471/board/local-login/`。`settings-server.mjs` がローカルの `board/dist` だけを配信する。
- 自動起動タスクは追加しない。設定サーバーは必要時に起動し、日次処理は既存タスクで独立して動く。
- 設定: `logs/local-login-settings.local.json`、接続先: `logs/local-login-portals.local.json`、資格情報: `credential-store/<id>-<設定世代>.json`（DPAPI CurrentUser、旧レコードは `<id>.json`）。端末間転送・snapshotへの追加は行わない。
- 配布する `portals.json` は空。既存5件は端末内設定へ保持し、サービス候補は `portal-presets.json` の正式名称10件から選ぶ。URL・認証方法は本人がGUIで入力する。
- クラウドGUIからの接続は別タブの起動案内のみ。クラウドへの設定API、リモートのMiniPC操作は追加していない。設定画面とAPIはローカル実装。2026-09-08の表示例追加時に、クラウドGUI側の起動案内も反映済み。

**この表は実態と一致していること。2026-07-24に台帳と実態のずれが原因で事故が起きた**:
`katazuku-calendar-sync` は表に載っていたが**実際には未登録**で、7/19以降カレンダーが
DBのappointmentへ同期されていなかった。meeting-autopilotはDBの予定しか見ないため、
7/23のリンクアイ面談は自動オープンも自動録画もされなかった。台帳を直したら実機も確認する。

**全タスクにバッテリー起動を許可すること**(`-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`)。
`New-ScheduledTaskSettingsSet` の既定は「バッテリー駆動なら起動しない/切替時に停止」で、
電源を外した瞬間に**無言で全自動処理が止まる**。2026-07-24に発覚。ただし daily-sync / mail-watch / asa は
当時フラグが抜けたままで、2026-08-17に全タスクへ再適用して解消(台帳と実態のずれの再発)。
register-*.ps1 の `New-ScheduledTaskSettingsSet` は共通設定に揃え、フラグ落ちを防ぐこと。
あわせて現行タスクは `LogonType=Interactive` のため**本人がログオン中のセッションでしか走らない**
(MiniPCへ移す場合は自動ログオンが前提。詳細は `docs/specs/15-minipc-migration.md`)。

## アプリのローカル保存

正本データのlocalStorageキーは廃止。各アプリが保存してよいのは
`katazuku/read-key`（閲覧用合言葉）だけ。
