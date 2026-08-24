# katazuku-shukatsu

**Local-first, human-in-the-loop automation core for Japanese _shūkatsu_ (new-grad job hunting).**

就活のルーチンを自動運転しつつ、「考える・受ける・認証する・決める」は必ず本人に残すための基盤。
このリポジトリは個人プロジェクト katazuku から、汎用で公開できる中核を切り出したものです。

> Status: early (v0.2)。中核のデータモデル・セマンティックレイヤーと、読み取り専用のアプリ群8本を公開しています。
> 応募自動運転・認証・ブラウザ操作は順次追加します。

## What's here / 収録範囲

| 領域 | 説明 |
|---|---|
| `src/db.ts` | 正本SQLiteのスキーマと**セマンティックレイヤー** — 状態遷移規則 `transition()`、企業名の名寄せ `resolveCompany`/`sameCompany`、冪等な突合 `sameAppointment`、正規化 |
| `src/application.ts` | 応募の状態機械。面接予定・締切をカレンダー送信待ち(outbox)へ載せ、承認ゲートと再開点を持つ |
| `src/db-apply*.ts` | メール・面接・カレンダー由来の入力を冪等にDBへ反映する書き込み層 |
| `src/agent-runtime.ts` | **provider非依存**のエージェント実行契約(Claude / Codex / ローカルモデルを目的・capability・承認点で抽象化) |
| `src/mobility.ts` | オンライン/対面・経路・移動可能性の判定 |
| `schemas/` | 入出力の JSON Schema。`settings.schema.json` は設定UIを生成する唯一の真実 |
| `examples/config-gui.html` | JSON Schema から設定フォーム・検証・出力を自動生成する設定GUI(単一HTML) |
| `examples/seed.ts` | 架空企業だけで正本DBを組み立てるデモ |
| `shared/` | アプリ群が共有する型・読み口・共通UI(`@katazuku/data` / `@katazuku/ui`) |
| `board/` ほか8本 | 正本DBを見る**読み取り専用アプリ群**([SmartHR Design System](https://smarthr.design/) 準拠) |

## 設計の芯

- **書き手はエージェントだけ**。正本はローカルSQLite 1つ。画面・シート・カレンダーは「見る窓」(一方向ミラー)
- **壊れても再開できる**。すべての外部確定操作に冪等キーと監査イベントを持たせる
- **安全境界はコードで強制**。ES・エントリーの送信は本人承認必須、Web適性検査の代理受験はしない([SECURITY.md](./SECURITY.md))
- **依存ゼロ**。ランタイム依存なし。標準の `node:sqlite` を使う

## Requirements

- **Node.js 22.5+**(推奨 24)。標準モジュール `node:sqlite` を使うため。
  - Node 24: そのまま動作します(experimental 機能のため実行時に `ExperimentalWarning` が出ます。抑止するなら `--disable-warning=ExperimentalWarning`)。
  - Node 22 系: `node:sqlite` に `--experimental-sqlite` が必要な場合があります(`NODE_OPTIONS=--experimental-sqlite`)。可能なら 24 を使ってください。
- ランタイム依存はゼロです。開発時のみ `tsx` / `typescript`(devDependencies)を使います。

## Quickstart

```sh
git clone https://github.com/kokotatan/katazuku-shukatsu.git
cd katazuku-shukatsu
npm install
npm run doctor    # 環境が動かせるか診断(OS・Node・node:sqlite)
npm test          # 架空データでコア・応募・移動・agent-runtime を検証
npm run seed      # メモリ上でスキーマの1例を組み立てて表示（ファイルは作らない）
```

設定GUIを見る場合は `examples/config-gui.html` をブラウザで開いてください。

Gmail・Calendar・Drive・Sheetsを使う場合は、各利用者が自分のGoogle Cloudプロジェクトと
デスクトップ用OAuthクライアントを作成します。配布元のアカウントへは紐づきません。

```sh
npm run setup:google -- --credentials /path/to/client_secret.json --email you@example.com
```

詳しい手順とOAuthをIn productionへ切り替える方法は
[Google Workspace連携](docs/GOOGLE_WORKSPACE_SETUP.md)を参照してください。

## アプリ群（読み取り専用の「見る窓」）

正本DBの状態を見るためのUIです。**どのアプリもDBへ書き込みません**。状態を変えるのは
エージェントと本人だけ、という原則をUIの構造で守っています。

| アプリ | 中身 |
|---|---|
| [`board/`](./board/) | きょう / 選考 / 企業 / ログ の4タブ。まずここ |
| [`insight/`](./insight/) | 今日やること。期限切れ・今日〜あさって・今週・待ち |
| [`status/`](./status/) | 選考管理。トラックごとの現在地と次の一手 |
| [`inbox/`](./inbox/) | メールと更新。要約とカテゴリだけ(本文は保存しない) |
| [`people/`](./people/) | 面接官・社員・OBOG。出会った根拠とメモ |
| [`prep/`](./prep/) | 面接準備。予定・企業研究・過去面接を会社ごとに束ねる |
| [`profile/`](./profile/) | 個人マスタ。確定情報と、面接由来の「候補」を分ける |
| [`impact/`](./impact/) | 自動運転の効果。推定時間ではなくDBに残った件数 |

```sh
npm run snapshot -- --demo    # 架空データのスナップショットを書き出す
cd insight && npm install && npm run dev
```

自分のデータで見るなら `npm run snapshot`(書き出した `snapshot.json` は gitignore 済み)。
共通の設計は [shared/README.md](./shared/README.md)、各アプリの詳細は [board/README.md](./board/README.md)。

## 公開API

入口は **`src/index.ts` の1つだけ**です。ここに出ている名前が公開契約で、SemVer はこの面にかかります。
`src/db.js` のような内部モジュールを直接 import すると、パッチ更新で壊れます。

```ts
import { openDb, transition, resolveCompany, applyDiff } from 'katazuku-shukatsu'
```

`npm run build` で `dist/`(JS + 型定義 + sourcemap)を出力します。`package.json` の `exports` は
このビルド成果物だけを指すので、公開していない内部モジュールへは到達できません。
JSON Schema は `katazuku-shukatsu/schemas/*.json` として別途参照できます。

公開面は `tests/check-api.ts` が固定しています。export を増やしたらこのテストの `EXPECTED` にも
足してください(=「意図して公開した」という記録になります)。

AIアシスタントに使い方を尋ねる場合は、リポジトリの [AGENTS.md](AGENTS.md) と [llms.txt](llms.txt) を読ませると、
セットアップ・設計・作法をすぐ答えられます。

## データの保管・複数デバイス

正本は単一のローカルSQLite（WALモード）です。実データをソースと一緒に誤ってコミットしないよう、
既定ではリポジトリ外のOS標準ユーザーデータ領域に保存します。

| OS | 既定の正本DB |
|---|---|
| Windows | `%LOCALAPPDATA%\katazuku-shukatsu\katazuku.db` |
| macOS | `~/Library/Application Support/katazuku-shukatsu/katazuku.db` |
| Linux | `${XDG_DATA_HOME:-~/.local/share}/katazuku-shukatsu/katazuku.db` |

`npm run doctor` で、この環境で実際に使われるパスを確認できます。**単一デバイス前提**で、
同じ正本を複数デバイスから同時に書かないでください。

- バックアップ・移送: `npm run backup`(`VACUUM INTO` で WAL を畳んだ1ファイルを作成)。
  別デバイスへ移すときはこの1ファイルを運びます。
- 正本を **Dropbox/OneDrive 等の同期フォルダ直下に置かない**でください(WAL がネットワークFSで破損しうる)。
- 正本DBのパスを変更する場合は環境変数 `KATAZUKU_DB`、または各CLIの明示引数で指定します。
- リポジトリ内に正本DBを置かないでください。`.gitignore` に加え、`npm run scan` も
  Git追跡対象のSQLiteファイルをヘッダと拡張子で拒否します。

## License

[Apache-2.0](./LICENSE)

---

このプロジェクトは日本の新卒一括採用(プレエントリー・ES・Web適性・面接日程調整)という固有の流れを対象にしています。
卒業年コホートなどの個人設定は設定可能で、実データ(氏名・企業・面接記録)はリポジトリに含めません。
