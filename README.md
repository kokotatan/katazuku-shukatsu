# katazuku-shukatsu

"katazuku" product group for shukatsu. This is for job hunting of Japanese University Students.

本番ドメイン: **https://katazuku.kotalab.com** (トップ = プロダクト一覧 / 各プロダクトはパス配下)

## 構成

```
landing/   … katazuku.kotalab.com トップページ(静的)
inbox/     … Katazuku Inbox (→ /inbox/ で配信)
pipeline/  … Katazuku Pipeline (→ /pipeline/ で配信)
scripts/   … dist/ 組み立て・通知スクリプト
docs/      … 開発進捗 (PROGRESS.md)
```

**ビルド & デプロイ (Vercel)**

```sh
npm run build   # inbox をビルドして dist/ に landing + /inbox を組み立て
vercel --prod   # リポジトリルートから(vercel.json が設定済み)
```

ローカル確認: `npx serve dist` / inbox単体の開発は `cd inbox && npm run dev` → http://localhost:5173/inbox/

## Products

### 🧹 Katazuku Inbox (`inbox/`)

就活メール、ぜんぶ片付く。見逃しゼロのインボックス。

企業からのメールを**自動仕分け**(面接・選考結果・ES提出・説明会)し、本文から**締切を自動抽出**して「あと◯日」で可視化。返信・提出が必要なメールだけを集めた**要対応キュー**を締切順に片付けていくだけで、見逃しがなくなります。

**主な機能**

- 🔥 要対応キュー — 返信・回答・提出が必要なメールだけを締切が近い順に表示
- ⏱ 締切自動抽出 — 「6月15日(月) 17:00まで」等の日本語表現をパースしてカウントダウン
- 🗂 自動カテゴリ分類 — 面接・日程調整 / 選考結果 / ES・提出タスク / 説明会・イベント
- ✅ ワンタップ片付け + ⏰ スヌーズ(明日の朝へ) + 📅 Googleカレンダー登録リンク
- ⌨️ キーボードショートカット (J/K/Enter/E/S) でサクサク処理
- 📧 Gmail連携(読み取り専用・クライアントサイドのみ・データは端末内に保存)
- 📂 JSONインポート/エクスポート(Claude の Gmail MCP 連携で書き出したメールも取込可)

**起動方法**

```sh
cd inbox
npm install
npm run dev   # → http://localhost:5173 (初回はデモデータで動きます)
```

**技術スタック**: Vite + React 19 + TypeScript + Tailwind CSS v4 / バックエンド不要(localStorage永続化)

### 📊 Katazuku Pipeline (`pipeline/`)

選考状況、ぜんぶ見える。就活パイプライン管理ボード。

企業ごとの選考ステージ(👀気になる → 📮エントリー → ✍️ES・テスト → 🗣️面接 → 🎉内定 / 🍃終了)を**ドラッグ&ドロップのカンバン**で管理。各社カードに「次にやること」と期限バッジ(あと◯日)が付き、列内は締切が近い順に自動ソート。

```sh
cd pipeline
npm install
npm run dev   # → http://localhost:5173/pipeline/
```

### ⏰ メール見張りクラウドルーチン

毎時0分、クラウドのエージェント(Haiku)がGmailをチェックし、重要メール(面接・締切・選考結果)だけを通知。通知済み管理はGmailラベル `katazuku-notified`。管理: https://claude.ai/code/routines
