# Changelog

このプロジェクトの変更履歴。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added

- Windows x64のポータブル試用版ビルダー。Electron・専用tsx・8画面・合成データを同梱し、Node/npmなしで初回設定と架空データ閲覧を起動する。個人設定・資格情報はアプリ保存領域へ分離し、配布物は公開ファイル許可リストから組み立てる。

- `npm start` / `npm run demo` から8画面を同じローカルURLで開く閲覧サーバー。デモと実データを分け、ホームで朝・前夜のまとめ、「今日やること」で未完了提出物を確認できる。
- 起動日の日本時間に合わせた架空デモの日付と、壊れたスナップショットの形式検査。
- 本人所有のデスクトップOAuthクライアントで接続する `npm run google:connect` を追加。Gmail・Calendarの読取り専用で、state/PKCE・本人一致・権限・APIを確認してから排他的に保存し、既存MCP資格情報は上書きしない。下書き・予定書込みには別MCP接続が必要。
- 実利用前のローカル診断 `npm run doctor -- --setup`、秘密値を含まない `.env.example`、Google/MCPの具体的な接続・読み取り確認手順を追加。設定例を運転可能と扱わず、通信やログインなしで不足を案内する。
- 初参加向けの日英ガイド(forkからPRまで)、既存の初心者向けIssueへの直接リンク、コード変更なしでも参加できる動作確認レポートのIssueフォーム。
- 自動運転ワークフロー(mail-watch / daily-sync / asa / evening-brief / calendar-sync / watchdog / inbox-tidy)を`npm run workflow`で実行できるようにした。設定は katazuku.config.json、定期実行は Windows タスクスケジューラ・cron・launchd・systemd に対応([docs/WORKFLOWS.md](docs/WORKFLOWS.md))。
- 提出物台帳(submission_requirement)・空き判定用の予定投影(schedule_block)・外部取得の鮮度(source_sync_state)。スキーマ v4。
- npm Trusted Publishing用のGitHub Actionsと、タグ・version・公開先を検査するリリースゲート。
- AIプロバイダを追加: 自分のAPIキーで動く anthropic-api / openai-api と、ChatGPT プラン利用(Sign in with ChatGPT、chatgpt-siwc。ローカル完結・フォーム不要のOSS向け手順)。provider 名の別名 claude-cli / codex-cli。[docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md)
- 開発者でなくても使えるデスクトップアプリ(Electron)の設計書と骨組み。初回ウィザード → サインイン → Google連携 → 定期実行、の流れを想定。
- README を「使いたい人」「開発に参加したい人」の2入口に刷新。認証なしで架空データを試せる `npm run demo`、セットアップ手順、good first issue 候補([docs/ROADMAP.md](docs/ROADMAP.md))。

### Security

- 閲覧サーバーを127.0.0.1に限定し、外部Origin/Host・書き込み・任意ファイル配信を拒否。実データがなくてもデモへ黙って切り替えない。
- npmパスワードや長期トークンをリポジトリ／GitHub Secretsへ置かず、OIDCで公開できる手順を追加。
- リポジトリ直下の `.npmrc` をgitignoreし、CLI認証情報の誤コミットを防止。

### Fixed

- 8画面の再読込が失敗してもエラーを隠し、以前のデータを最新のように表示していた問題。最後に取得した内容を保持し、未更新の警告と再試行の手順を表示する。
- デスクトップの骨組みがAI未選択の設定を成功として保存していた問題。コアのSchemaで保存前に検証し、既存設定を置換せず、保存と実接続・定期登録の完了を区別する。
- 個別Vite起動では別アプリへの移動が同じ画面へ戻る問題を、統合ローカル起動で解消。
- 未設定・未同期の状態でも「自動運転が監視中」と断定していた空状態の案内。
- SETUPの削除手順が実データのスナップショットと外部の認証情報・バックアップを含めていなかった点。

## [0.3.0] - 2026-09-03

### Added

- 就活エージェント・就活メディア・イベント運営者を、応募先企業とは別の
  `career_organization` / `career_meeting` として保持する。未解決の面談は捨てず `review` で停止する。
- 支援面談のカレンダー取込み、録音run、議事録反映。氏名不明の人物は人物マスタへ登録しない。
- Cloudflare Worker + R2を使う任意のセルフホスト。作者のアカウントに依存せず、
  利用者が自分のCloudflareへ配置する。
- 公開ロードマップと、`good first issue` / Discussionsから参加できる導線。
- npm package `katazuku-shukatsu` の配布設定。

### Security

- Cloudflareの読み取り用と書き込み用秘密値を分離し、未設定・32 byte未満・同一値ならfail-closedにする。
- スナップショットをストリーミングしながら16 MiBで制限し、宣言サイズの詐称でも超過を防ぐ。
- Bearer認証を別オリジンの閲覧アプリから使えるよう、CORS preflightを追加する。

### Changed

- 就活支援組織・支援面談をschema v3の非破壊migrationで追加する。
- 公式の配布経路としてnpmを追加する。

### Fixed
- 内定(offer)を不合格で自動的に潰さない。別トラックの不合格メールの誤割当から内定を保護する(#5)
- 予定の日時が解釈不能な文字列のとき例外にし、カレンダー送信待ち(outbox)からの沈黙脱落を防ぐ(#6)
- カレンダー更新で予定を別トラックへ勝手に付け替えない(トラック乗っ取り防止。#4)
- カレンダー再同期が「完了」だけでなく「中止」も「予定」へ巻き戻さない
- applyDiff を per-item SAVEPOINT 化し、1件の例外でその日の反映が全損しないようにする

## [0.2.0] - 2026-08-17

最初の公開リリース。0.1.0 は内部で切ったところまでで、タグは打っていません。

### Added

- **アプリ群8本と共有層**(第二弾)。本体(private)のアプリ群を公開用に移植した。
  ディレクトリ構成は本体と同じ並びで、`docs/oss-publish.md` の双方向同期がそのまま成立する。
  - `shared/` — `@katazuku/data`(型 `KatazukuData` と読み口。本体と同形)と
    `@katazuku/ui`(`AppShell` / `AppNav` / `DataState` / `AppHeading` / `Tile`)
  - `board/` — きょう / 選考 / 企業 / ログ の4タブ
  - `insight/` — 今日やること(期限切れ・今日〜あさって・今週・待ち)
  - `status/` — 選考管理。`inbox/` — メールと更新。`people/` — 人
  - `prep/` — 面接準備。`profile/` — 個人マスタ。`impact/` — 自動運転の効果
  - 描画は全部 [SmartHR Design System](https://smarthr.design/) / smarthr-ui に載せ替えた
    (本体は生Tailwindで、smarthr-ui は Button だけだった)。ロゴ・ブランドは使わない
  - 本体はサーバ `/api/data` を合言葉つきで叩くが、公開版はサーバを持たない。
    `npm run snapshot` が書き出したローカルの1枚のJSONを全アプリへ配る
  - **`AppNav` は `shared/` に1つだけ**置いた。本体は8アプリへコピー同期していたが、
    アプリを足すたび8ファイル直す運用をOSSへ持ち込まないため
  - 出さないもの: マイページのログインID・パスワード、顔写真の実体、メール本文、氏名の既定値
  - `shared/` は node_modules を持たない(Reactの二重読み込みを防ぐ)。型は各アプリの
    `paths`、実体は Vite の `resolve.dedupe` が1つに固定する
- `npm run snapshot`(`scripts/snapshot.ts`)。`--demo` で架空データ、無指定で自分の正本DBから
  スナップショットを書き出す。実データの `snapshot.json` は gitignore 済み。
- **公開API面の確定と配布可能化** (#5)。`src/index.ts` を「出したい名前だけ」に絞り、
  `npm run build` で `dist/`(JS + 型定義 + sourcemap)を出力する。`package.json` に
  `main` / `types` / `exports` / `files` を定義し、`exports` はビルド成果物と `schemas/*.json` だけを指す。
- 公開面を固定する `tests/check-api.ts`。宣言していない名前が増えたり、内部ヘルパー(`normalize`
  `commandPreview` など)が漏れたら CI で落ちる。
- **`profile_basic` / `company_dossier` / `mail_item` の writer** (#9)。読み口だけあって誰も書けない
  公開面だった。`saveBasicProfile` / `getBasicProfile` / `upsertCompanyDossier` / `upsertMailItem` /
  `listActionableMail` を同梱し、いずれも冪等upsertにした。
- **マイグレーションを版ゲート方式にした** (#10)。`PRAGMA table_info` を毎回舐める場当たり方式をやめ、
  `user_version` で束ねた `MIGRATIONS` を番号順に一度だけ適用する。破壊的な版(列DROP・データ移送)は
  **適用前に `VACUUM INTO` でスナップショットを取り**、取れなければ適用しない。コードが知らない
  未来の版のDBは開かずに落とす(古いコードで新しいDBを壊さないため)。
- **書き込み層のテスト** `tests/check-write-layer.ts` (#6、30件)。`applyCalendar` の昇格・冪等・更新、
  `findAppointmentMatch` の優先順、`upsertPerson` の敬称/包含名寄せ、`savePersonPhoto`、
  `applyInterview` の再実行を、合成ラベルのフィクスチャで固定した。
- `tests/check-platform.ts`(13件)と `tests/check-migration.ts`(7件)。
- `DEFAULT_CAPABILITY_TOOLS` / `DEFAULT_ABORT_PATTERNS` を公開 (#8)。

### Fixed

- **名寄せが別法人を無確認でマージしうる問題** (#7)。`normalize()` が法人格を落とすため
  「株式会社X」と「合同会社X」、「X K.K.」と「X Corp」が同じ芯に潰れ、`resolveCompany` の
  完全一致経路がそれを自動マージしていた。法人格が矛盾する組み合わせは `suspicious` を返し、
  本人確認(=`addAlias` 学習)を1回挟むようにした。
- `openDb` がマイグレーション失敗時にDBハンドルを掴んだままにならないようにした。
- README に残っていた画像アップロードの失敗跡(`![Uploading image.png…]()`)を削除。

### Changed

- `normalize()` の除去語を「法人の種類」だけに限定。`holdings` / `company` はトレードネームの
  一部になりうるため除去しない(「X Holdings」と「X」は別法人)。代わりに `limited` / `plc` /
  `pte` / `pty` / `llp` と、`一般社団法人` などの日本の法人形態を追加した。
- `upsertCompany()` は紛らわしい名前で新規作成するとき、要確認(`pending_review`)に積むようになった。
  黙って重複法人が増えるのを防ぐ。
- **`applyInterview` に `db` を注入できるようにした** (#6)。`applyCalendar` と同じ形。
  これまで内部で `openDb(DB_PATH)` を呼んでいて、テストからも合成からも触れなかった。
- **環境固有物を注入できるようにした** (#8)。capability→CLIツール名の対応表(MCPサーバ名を含む)は
  `AdapterOptions.capabilityTools` で、agent自身の中止宣言を読むパターン(日本語のプロンプト規約)は
  `detectProcessFailure` の第2引数で差し替えられる。既定値は `DEFAULT_CAPABILITY_TOOLS` /
  `DEFAULT_ABORT_PATTERNS` として公開したので、まるごと書き写さずに拡張できる。
- モジュール解決を `nodenext` に変更し、相対 import に `.js` 拡張子を付けた(Node の ESM 仕様に合わせ、
  ビルド成果物がそのまま実行できるようにするため)。

## [0.1.0] - 2026-08-15

内部で切った最初のカット(タグは打っていません)。

### Added
- 正本SQLiteのスキーマとセマンティックレイヤー(状態遷移 `transition()`、企業名の名寄せ、冪等な予定突合、正規化)
- 応募の状態機械(承認ゲート・カレンダー送信待ち・再開点)
- メール/面接/カレンダー由来の入力を冪等に反映する書き込み層(`db-apply*`)
- provider非依存のエージェント実行契約(`agent-runtime`)
- 移動可能性の判定(`mobility`)
- JSON Schema(応募イベント / 設定)と、Schema駆動の設定GUI(`examples/config-gui.html`)
- 依存ゼロの自前assertテスト(core / application / mobility / agent-runtime)
- 環境診断 `npm run doctor`、匿名の1例 `npm run seed`
- 公開ゲート: 漏洩スキャナ `tools/scan-secrets.mjs` と GitHub Actions CI(scan + test)

[Unreleased]: https://github.com/kokotatan/katazuku-shukatsu/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/kokotatan/katazuku-shukatsu/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/kokotatan/katazuku-shukatsu/releases/tag/v0.2.0
