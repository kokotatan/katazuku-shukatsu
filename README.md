# katazuku-shukatsu

**Local-first, human-in-the-loop automation core for Japanese _shūkatsu_ (new-grad job hunting).**

就活のルーチンを自動運転しつつ、「考える・受ける・認証する・決める」は必ず本人に残すための基盤。
このリポジトリは個人プロジェクト katazuku から、汎用で公開できる中核を切り出したものです。

> Status: early (v0.1). まずは中核のデータモデルとセマンティックレイヤーを公開しています。
> 応募自動運転・認証・ブラウザ操作・設定UIは順次追加します。

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
npm run seed      # スキーマの1例で正本DBを組み立てて表示
```

設定GUIを見る場合は `examples/config-gui.html` をブラウザで開いてください。
公開APIの入口は `src/index.ts`(現状は clone して TypeScript から import する形。npm 配布は今後)。

## データの保管・複数デバイス

正本は単一のローカルSQLite(`data/katazuku.db`、WALモード)です。**単一デバイス前提**で、
同じ正本を複数デバイスから同時に書かないでください。

- バックアップ・移送: `npm run backup`(`VACUUM INTO` で WAL を畳んだ1ファイルを作成)。
  別デバイスへ移すときはこの1ファイルを運びます。
- 正本を **Dropbox/OneDrive 等の同期フォルダ直下に置かない**でください(WAL がネットワークFSで破損しうる)。
- 正本DBのパスは環境変数 `KATAZUKU_DB` で指定します。

## License

[Apache-2.0](./LICENSE)

---

このプロジェクトは日本の新卒一括採用(プレエントリー・ES・Web適性・面接日程調整)という固有の流れを対象にしています。
卒業年コホートなどの個人設定は設定可能で、実データ(氏名・企業・面接記録)はリポジトリに含めません。
