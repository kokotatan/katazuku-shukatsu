# Changelog

このプロジェクトの変更履歴。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- **アプリ群の移植を開始**(第二弾)。本体(private)のアプリ群のうち `shared/`(共有データ層)と
  `board/`(読み取り専用ボード)を公開用に移植した。ディレクトリ構成は本体と同じ並びにしてあり、
  `docs/oss-publish.md` の双方向同期がそのまま成立する。
  - `shared/` = `@katazuku/data`。スナップショットの型(`KatazukuData`)と読み口。型は本体と同形
  - `board/` = 本体の board と同じ4タブ(きょう / 選考 / 企業 / ログ)。描画は
    [SmartHR Design System](https://smarthr.design/) / smarthr-ui に載せ替えた
  - 本体はサーバ `/api/data` を合言葉つきで叩くが、公開版はサーバを持たない。
    `npm run snapshot` が書き出したローカルの1枚のJSONを読む
  - 出さないもの: マイページのログインID・パスワード、顔写真の実体、メール本文
  - 未移植: `status` `inbox` `profile` `people` `prep` `impact` `insight`(順次)
- `npm run snapshot`(`scripts/snapshot.ts`)。`--demo` で架空データ、無指定で自分の正本DBから
  スナップショットを書き出す。実データの `snapshot.json` は gitignore 済み。


