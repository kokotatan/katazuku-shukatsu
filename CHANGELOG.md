# Changelog

このプロジェクトの変更履歴。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- **読み取り専用ボードの参照実装** `examples/board/`(第二弾)。[SmartHR Design System](https://smarthr.design/) /
  smarthr-ui に準拠したReact SPA。DBへは触らず `snapshot.json` 1枚だけを読み、書き込みボタンを1つも持たない
  ことで「書き手はエージェントだけ」という原則をUIの構造で守る。会議URLとメール本文は画面に出さない。
  コアのランタイム依存ゼロは維持(ボードは `examples/board/` に閉じた別の `package.json`)。
- `npm run board:demo` / `npm run board:snapshot`(`examples/board-snapshot.ts`)。前者は架空データ、
  後者は自分の正本DBからスナップショットを書き出す。実データの `snapshot.json` は gitignore 済み。
- **公開API面の確定と配布可能化** (#5)。`src/index.ts` を「出したい名前だけ」に絞り、
  `npm run build` で `dist/`(JS + 型定義 + sourcemap)を出力するようにした。`package.json` に
  `main` / `types` / `exports` / `files` を定義し、`exports` はビルド成果物と `schemas/*.json` だけを指す。
- 公開面を固定する `tests/check-api.ts`。宣言していない名前が増えたり、内部ヘルパー(`normalize`
  `commandPreview` など)が漏れたら CI で落ちる。
- **`profile_basic` / `company_dossier` / `mail_item` の writer** (#9)。読み口だけあって誰も書けない
  公開面だった。`saveBasicProfile` / `getBasicProfile` / `upsertCompanyDossier` / `upsertMailItem` /
  `listActionableMail` を同梱し、いずれも冪等upsertにした。`tests/check-platform.ts` を追加。

### Fixed
- **名寄せが別法人を無確認でマージしうる問題** (#7)。`normalize()` が法人格を落とすため
  「株式会社X」と「合同会社X」、「X K.K.」と「X Corp」が同じ芯に潰れ、`resolveCompany` の
  完全一致経路がそれを自動マージしていた。法人格が矛盾する組み合わせは `suspicious` を返し、
  本人確認(=`addAlias` 学習)を1回挟むようにした。

### Changed
- `normalize()` の除去語を「法人の種類」だけに限定。`holdings` / `company` はトレードネームの
  一部になりうるため除去しない(「X Holdings」と「X」は別法人)。代わりに `limited` / `plc` /
  `pte` / `pty` / `llp` と、`一般社団法人` などの日本の法人形態を追加した。
- `upsertCompany()` は紛らわしい名前で新規作成するとき、要確認(`pending_review`)に積むようになった。
  黙って重複法人が増えるのを防ぐ。
- モジュール解決を `nodenext` に変更し、相対 import に `.js` 拡張子を付けた(Node の ESM 仕様に合わせ、
  ビルド成果物がそのまま実行できるようにするため)。`src` 内から `../src/...` を参照していた箇所も
  `./...` に正した。

## [0.1.0] - 2026-08-15

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

[Unreleased]: https://github.com/kokotatan/katazuku-shukatsu/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/kokotatan/katazuku-shukatsu/releases/tag/v0.1.0
