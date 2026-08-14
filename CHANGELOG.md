# Changelog

このプロジェクトの変更履歴。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

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
