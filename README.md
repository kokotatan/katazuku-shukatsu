# katazuku — 就活、ぜんぶ片付く。

日本の大学生(作者ひとり)のための就活プロダクト群。
本番ドメイン: **https://katazuku.kotalab.com** (トップ = プロダクト一覧 / 各プロダクトはパス配下)

開発規約は `CLAUDE.md`(Claude Code) / `AGENTS.md`(Codex) / `.github/copilot-instructions.md`(Copilot)。
次の実装は `docs/specs/` を番号順に。進捗の一次情報は `docs/PROGRESS.md`。

## 構成

```
landing/   トップページ(静的)
inbox/     Katazuku Inbox    → /inbox/    メール見逃しゼロ + AI返信生成
pipeline/  Katazuku Pipeline → /pipeline/ 選考管理カンバン + シート連携
today/     Katazuku Today    → /today/    今日やること横断ダッシュボード
notes/     Katazuku Notes    → /notes/    ES部品庫・文字数カウンタ
prep/      Katazuku Prep     → /prep/     面接振り返り・直前モード
scripts/   dist組立 / ローカル配信(serve.ps1) / 毎朝の自動同期(daily-sync)
docs/      PROGRESS.md(進捗) / specs/(実装仕様) / MINIPC-SETUP.md(移行手順)
```

共通スタック: Vite + React 19 + TypeScript + Tailwind v4。バックエンドなし・localStorage永続化。
デザインは「帳簿的ミニマリズム」(紙とインクのウォームグレー、朱は警告専用、見出しはしっぽり明朝、絵文字なし)。

## ビルド・起動・テスト

```powershell
npm run build                      # 5アプリのビルド + dist/ 組立(個人データは除外される)
powershell -File scripts\serve.ps1 # ローカル常時配信(5アプリ、スマホからもアクセス可)
npm --prefix inbox run dev         # 単体の開発サーバー(他アプリも同様)

# 検証スクリプト(全8スイート)
cd inbox;    npx tsx scripts/check-classify.ts; npx tsx scripts/check-actions.ts
cd inbox;    npx tsx scripts/check-selection.ts; npx tsx scripts/check-pipeline.ts
cd pipeline; npx tsx scripts/check-import.ts;   npx tsx scripts/check-sheet.ts
cd today;    npx tsx scripts/check-aggregate.ts
cd notes;    npx tsx scripts/check-count.ts
cd prep;     npx tsx scripts/check-prep.ts
```

デプロイ(任意): `vercel --prod`(vercel.json 設定済み)。公開版ではAI返信生成のみ動かない(下記)。

## Products

### Katazuku Inbox (`inbox/`)

就活メール、ぜんぶ片付く。見逃しゼロの受信箱。

- 要対応キュー: 返信・回答・提出が必要なメールだけを締切順に。J/K/Enter/E/S のキーボード操作
- 自動分類: 面接・日程調整 / 選考結果 / ES・提出タスク / 適性検査 / 説明会 / その他
- 判定レイヤー: 「選考」「募集案内」「課外活動(ハッカソン・長期インターン等)」「宣伝」を送信元と本文から判定。
  サイドバーの「選考のみ」タブで進行中の選考だけを見られる
- やることリスト抽出: 「日程を選んで回答」「ESを提出」等のチップと「フォームを開く」直リンク
- 締切の日本語パース(「6月15日(月) 17:00まで」)、カレンダー登録リンク、スヌーズ
- 選考ボードへ: ワンタップでPipelineに企業を追加(表記ゆれ名寄せ・ステージは前進のみ)
- AI返信生成: カードの「返信」からClaudeが返信文を作成(下記の仕組み)
- データ取込: 起動時に `public/gmail-import-auto.json` を自動読込(gitignore済)。JSONインポート/エクスポート、
  Gmail直接続(クライアントサイドOAuth)も可

**AI返信生成の仕組み**: devサーバー/`vite preview` が、ログイン済みの Claude Code CLI を `claude -p` で呼ぶ
(`inbox/vite.claude-reply.ts`)。**Claudeサブスクリプションの範囲内で動き、APIキー不要**。
内容を考える返信(日程調整・選考結果・質問あり)はSonnet、定型確認はHaikuに自動振り分け。
claude CLIが居ないクラウド(Vercel公開版)では使えない — 必要になったら `docs/specs/01-reply-api.md`。

### Katazuku Pipeline (`pipeline/`)

選考状況、ぜんぶ見える。カンバンボード。

- 7ステージ: 気になる / エントリー済み / ES・テスト / 面接・面談 / インターン合格 / 内定 / 終了
- カードに業界・志望度バッジ、期限バッジ(あと何日)、マイページ直リンク、対策ノート(Prep)への導線
- 選考管理シート(Google Sheets)連携: 取込(JSONインポート)と書き戻し(「シートに反映」)。
  書き戻しは差分プレビュー付きで、合格/不合格/辞退・メモ・数式列には触れない設計
- CLI同期 `pipeline/scripts/sheet-sync.ts`(サービスアカウント・dry-run既定)

### Katazuku Today (`today/`)

今日やること、ぜんぶここに。Inboxの締切とPipelineの予定を横断して
「期限切れ / 今日 / 今週」だけを一枚に。朝いちばんに開くページ。

### Katazuku Notes (`notes/`)

ESの部品、ぜんぶ揃う。ガクチカ・研究概要・自己PR・志望動機を部品として保存し、
常時表示の文字数カウンタ(改行除外・全角換算)と目標文字数(「あと52字」「12字オーバー」)で
400字版・600字版を量産。使った企業も記録(選考ボードから補完)。

### Katazuku Prep (`prep/`)

面接の前に、5分。企業ごとの振り返り・想定問答と全社共通の「就活の軸」を貯める。
直前モードでは設問が明朝の大きな文字で一問ずつ流れる(クリック/Enterで答え表示、J/Kで前後)。
振り返りの横断ビューで「同じ失敗の繰り返し」にも気づける。

## 自動化

- **毎時のメール見張り**: claude.aiクラウドのルーチン(Haiku)が重要メールだけ通知。管理: https://claude.ai/code/routines
- **毎朝のシート同期**: タスクスケジューラ → `scripts/daily-sync.ps1` → `claude -p`。
  メール分析 → 選考管理シート更新 → Inbox用データ書き出し → 受信トレイのフラット化(重要メールは保護)。
  セットアップは `docs/MINIPC-SETUP.md`
