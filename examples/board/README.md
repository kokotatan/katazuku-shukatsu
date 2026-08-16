# katazuku board（参照実装）

正本DBの状態を見るための、**読み取り専用**のボードです。第二弾として公開したUIの参照実装で、
[SmartHR Design System](https://smarthr.design/) / [smarthr-ui](https://github.com/kufu/smarthr-ui) に準拠しています。

> このボードは SmartHR 社とは無関係の個人プロジェクトです。OSS として公開されているデザインシステムと
> コンポーネントライブラリを利用しているだけで、SmartHR のロゴ・ブランドは使用していません。

## 設計

このリポジトリの原則「**書き手はエージェントだけ。画面は見る窓**」をUIの構造で守っています。

- **DBへ触りません。** 読むのは `public/snapshot.json` という1枚のJSONだけです
- **サーバがありません。** ビルド成果物は静的ファイルなので、どこにも常駐しません
- **出さないものがあります。** 会議の参加URLは出しません(「オンラインかどうか」だけ表示)。
  メール本文はそもそもDBに持たず、要約とカテゴリだけを表示します

つまりこのUIは、権限を持たないことで安全を担保しています。書き込みボタンは1つもありません。

## 使い方

```sh
# 1. スナップショットを作る
npm run board:demo        # リポジトリのルートで。架空データ(同梱済み)
npm run board:snapshot    # 自分の正本DB(data/katazuku.db または $KATAZUKU_DB)から

# 2. ボードを開く
cd examples/board
npm install
npm run dev
```

`public/snapshot.json`(実データ)があればそれを、無ければ `public/snapshot.demo.json`(架空データ)を
読みます。**実データのスナップショットは `.gitignore` 済みです。コミットしないでください。**

## 画面

| タブ | 中身 |
|---|---|
| 選考 | 企業・季節・職種・ステータス・次の行動。状態は `outcomeOf()` の機械判定を `StatusLabel` で表示 |
| 予定 | 面接・締切。時刻が00:00のものは日付だけの締切として表示 |
| 要確認 | 名寄せが怪しくて本人確認へ回った企業名(`pending_review`)。ここが空ならDBは意図どおり |
| 要対応メール | `listActionableMail()` の結果。締切のあるものが先 |

「要確認」に出るのは、たとえば `合同会社ガンマ` が既にあるところへ `株式会社ガンマ` が来たケースです。
エージェントは自動でマージせず、ここへ積みます(理由は
[`resolveCompany`](../../src/db.ts) の設計を参照)。

## 依存について

コア(`src/`)は**ランタイム依存ゼロ**のままです。このボードは `examples/board/` に閉じた別の
`package.json` を持っており、npm パッケージ `katazuku-shukatsu` には含まれません。
コアを使うのにReactもSmartHR UIも必要ありません。
