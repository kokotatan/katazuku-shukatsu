# Changelog

このプロジェクトの変更履歴。形式は [Keep a Changelog](https://keepachangelog.com/ja/1.1.0/)、
バージョンは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

## [Unreleased]

### Added
- **アプリ群を全部移植した**(第二弾)。本体(private)の8アプリと共有層を公開用に移植。
  ディレクトリ構成は本体と同じ並びで、`docs/oss-publish.md` の双方向同期がそのまま成立する。
  - `shared/` — `@katazuku/data`(型 `KatazukuData` と読み口。本体と同形)と
    `@katazuku/ui`(`AppShell` / `AppNav` / `DataState` / `AppHeading` / `Tile`)
  - `board/` — きょう / 選考 / 企業 / ログ の4タブ
  - `insight/` — 今日やること(期限切れ・今日〜あさって・今週・待ち)
  - `status/` — 選考管理。`inbox/` — メールと更新。`people/` — 人
  - `prep/` — 面接準備。`profile/` — 個人マスタ。`impact/` — 自動運転の効果
  - 描画は全部 [SmartHR Design System](https://smarthr.design/) / smarthr-ui に載せ替えた
    (本体は生Tailwindで、smarthr-ui は Button だけだった)
  - 本体はサーバ `/api/data` を合言葉つきで叩くが、公開版はサーバを持たない。
    `npm run snapshot` が書き出したローカルの1枚のJSONを全アプリへ配る
  - **`AppNav` は `shared/` に1つだけ**置いた。本体は8アプリへコピー同期していたが、
    アプリを足すたび8ファイル直す運用をOSSへ持ち込まないため
  - 出さないもの: マイページのログインID・パスワード、顔写真の実体、メール本文
  - `shared/` は node_modules を持たない(Reactの二重読み込みを防ぐ)。型は各アプリの
    `paths`、実体は Vite の `resolve.dedupe` が1つに固定する
- `npm run snapshot`(`scripts/snapshot.ts`)。`--demo` で架空データ、無指定で自分の正本DBから
  スナップショットを書き出す。実データの `snapshot.json` は gitignore 済み。


