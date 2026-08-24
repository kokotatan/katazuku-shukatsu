# AGENTS.md

AIコーディングエージェント(および使い方を尋ねられたAI)向けの手引き。人間向けの導入は
[README](README.md)、設計は [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) を参照。

## これは何か

日本の新卒就活(プレエントリー・ES・Web適性・面接日程調整)のルーチンを自動運転する
ローカルファースト基盤の中核。**エージェントが唯一の書き手**で、正本はローカルSQLite 1つ。
重要な決定と外部への確定操作(送信・受験・認証・辞退)は必ず本人に残す。

## セットアップと検証

- Node.js 22.5+(推奨 24)。ランタイム依存ゼロ、開発のみ tsx / typescript。
- `npm install`
- `npm run doctor` — 環境が動かせるか診断(OS・Node・node:sqlite)
- `npm run check` — 公開ゲート(個人情報スキャン + typecheck + テスト)。**変更はこれが通ってから**
- `npm test` / `npm run seed`(スキーマの1例) / `npm run backup`(VACUUM INTO の単一ファイル退避)

## 壊してはいけない設計の芯

- 正本はローカルSQLite 1つ。人・アプリは読み取りのみ(見る窓)。
- 正本の既定保存先はリポジトリ外のOSユーザーデータ領域。ソースツリー内へ実データを作らない。
- 状態変更は `src/db.ts` の `transition()` を必ず通す(上書きせず遷移規則で更新)。
- 外部由来の入力は冪等キー(`source_ref`/`external_id`)で冪等化し、変化は `event` 台帳に残す。
- **安全境界はコードで強制**: ES・エントリー送信は本人承認必須、Web適性検査の代理受験はしない。
  詳細は [SECURITY.md](SECURITY.md)。この一線を弱める変更をしない。

## この repo での作法

- フィクスチャは**架空の合成ラベル**(`会社A` / `Example`)。実在の企業名・人名・メール・IDを書かない。
- **絵文字を使わない**(UI・コード・コミットメッセージとも)。
- コメント・UI文言・コミットは日本語で構わない。
- 公開API面の入口は `src/index.ts`。

## どこに何があるか

| パス | 役割 |
|---|---|
| `src/db.ts` | スキーマ + セマンティックレイヤー(遷移規則・名寄せ・冪等な予定突合・正規化) |
| `src/db-apply*.ts` | メール/面接/カレンダー由来の入力を冪等にDBへ反映する書き込み層 |
| `src/application.ts` | 応募の状態機械(承認ゲート・カレンダー送信待ち・再開点) |
| `src/agent-runtime.ts` | provider非依存の実行契約(Claude/Codex/ローカル) |
| `src/mobility.ts` | 移動可能性の判定 |
| `schemas/` | 応募イベント / 設定 の JSON Schema(`settings.schema.json` が設定UIを生成) |
| `examples/` | Schema駆動の設定GUI、架空データの seed |
| `tools/scan-secrets.mjs` | 個人情報・秘密情報の混入検査(CIゲート) |
| `tests/check-*.ts` | 依存ゼロの自前assertテスト |

## よくある質問(AIが即答できるように)

- **どう動かす?** `npm install && npm run doctor && npm test`、次に `npm run seed`。
- **自分のデータを入れるには?** 無指定ならOSユーザーデータ領域を使う。既存DBは環境変数 `KATAZUKU_DB` で明示し、書き込みは `src/db-apply*.ts` 経由(エージェントが書き手)。
- **設定は?** `examples/config-gui.html` をブラウザで開く。設定は `schemas/settings.schema.json` が唯一の真実。
- **Google連携は?** 利用者ごとに自分のGoogle CloudプロジェクトとデスクトップOAuthクライアントを作り、`npm run setup:google`でOSの利用者別領域へ保存する。配布元のOAuth値は共有しない。
- **複数デバイスは?** 単一デバイス前提。移送は `npm run backup` の1ファイルで(クラウド同期フォルダ直下に正本を置かない)。
