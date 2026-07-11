# katazuku — 就活プロダクト群

就活生・奥山彪太郎さん個人のためのプロダクト群。ユーザーは本人ただ一人。
「散らかった就活タスクを気持ちよく片付ける」が全プロダクト共通の目的。

## 構成

```
landing/          トップページ (katazuku.kotalabo.com 予定)
inbox/            メール自動仕分けSPA      → /inbox/
status/           選考管理カンバン(進捗管理) → /status/
api/              Vercel Functions (spec01実装済み。デプロイ待ち)
scripts/          dist組立・毎日同期 (daily-sync.ps1 + daily-sync-prompt.md)
chrome-prompts/   Claude in Chrome 用ブラウザ操作プロンプト集
docs/PROGRESS.md  開発進捗の詳細 (一次情報)
docs/specs/       次に実装するプロダクトの仕様書 (/goal にそのまま渡せる粒度)
docs/MINIPC-SETUP.md  miniPC移行手順
```

いずれも Vite + React 19 + TypeScript + Tailwind v4。**バックエンドなし、localStorage永続化**
(例外: api/ のVercel Functionsのみサーバー側)。アプリ内のメール分類・締切抽出は
**ルールベース**(正規表現)で、LLMは使わない。LLMを使うのは api/ とClaude経由の運用のみ。

## コマンド

```powershell
npm run build                      # 全ビルド (tsc + vite + dist組立。これが通らないと完了ではない)
npm --prefix inbox run dev         # Inbox 開発サーバー (http://localhost:5173/inbox/)
npm --prefix status run dev        # Status 開発サーバー

# テスト (全部通すこと。新機能には同形式の check-*.ts を追加する)
cd inbox;    npx tsx scripts/check-classify.ts    # 実メール50件の分類検証 (目視確認用)
cd inbox;    npx tsx scripts/check-actions.ts     # アクション抽出
cd inbox;    npx tsx scripts/check-selection.ts   # 選考/募集/課外/宣伝の判定
cd inbox;    npx tsx scripts/check-pipeline.ts    # Inbox→Pipeline連携
cd inbox;    npx tsx scripts/check-dates.ts       # 締切抽出(日付・時刻・緊急度)
cd inbox;    npx tsx scripts/check-reply-api.ts   # 返信APIのフォールバックテンプレート
cd inbox;    npx tsx scripts/check-needs-action.ts # 要対応判定(宣伝・就活外は積まない)
cd status;   npx tsx scripts/check-import.ts      # シート取込マージ
cd status;   npx tsx scripts/check-sheet.ts       # シート書き戻し
cd insight;  npx tsx scripts/check-aggregate.ts   # 今日やること集計(宣伝除外・同社同日の1行化)
```

## デザインシステム「SmartHR Design System 準拠」(厳守)

2026-07-11に旧「帳簿的ミニマリズム」(墨色+朱+明朝)から全面移行した。

- **絵文字は全面禁止**(UI・コード・コミットメッセージとも)。アイコンは smarthr-ui の Fa*Icon を使う
- コンポーネントは **smarthr-ui を第一候補**にする(Button/Dialog/Input/StatusLabel/Fa*Icon 等)。
  テーマは `createTheme()` のデフォルト(SmartHRブルー)のまま。独自色で上書きしない
- 配色は Tailwind トークンで管理し、**値は smarthr-ui の defaultColor と同一に保つ**
  (`<app>/src/index.css` は5アプリで同一内容を保つ):
  - `slate-*` = SmartHRグレースケール(GREY_5〜GREY_100。50/100/200/300/400/500/900が公式値)
  - `blue-*` = プロダクトブルー(MAIN #0077c7 / TEXT_LINK #0071c1)。操作・リンク・選択状態
  - `red-*` = DANGER(#e01e5a)。**締切・要対応・エラーの警告専用**。装飾に使わない
  - `teal-500` = SMARTHR_BLUE(#00c4cc)。**ブランドマーク専用**。UIには使わない
- フォントはシステムゴシック(Hiragino Sans / Yu Gothic系)。**明朝・Webフォントは使わない**。
  `font-display` は互換エイリアスとして残っているがゴシックを指す(新規コードでは使わない)
- ブランドマークは「片」一字のティール角印(角丸8px)。AppNav実装を参照
- **共通左サイドナビ `src/components/AppNav.tsx`** を全アプリに配置(コピー同期で同一内容を保つ)。
  ランディング(`landing/index.html`)にも同デザインのサイドナビを静的HTMLで実装済み。
  アプリを増やす/名前を変えるときは AppNav(5アプリ)+ landing の両方を更新すること
- 角丸は SmartHR の s/m/l(4/6/8px)相当。影よりも罫線(`border-slate-300`)で区切る

## データとセキュリティ(最重要)

以下は個人情報・秘密情報。**gitに絶対コミットしない**(gitignore済み。新パターンを作ったら必ず追記):
- `inbox/gmail-import-*.json`・`inbox/public/gmail-import-auto.json`(実メール)
- `pipeline/sheet-import-*.json`(選考状況)
- `pipeline/service-account.json`(Google SA鍵)
- `logs/`、`*.local.md`、`notify-*.json`

`scripts/assemble.mjs` は配信物 `dist/` から個人データを除外する。**新しい個人データファイルを
public/ に置く場合は assemble.mjs の除外処理にも必ず追加すること**(漏れると本番公開で漏洩する)。

## アプリ間連携の決まり

- 同一オリジン前提のlocalStorage共有で連携する(本番は katazuku.kotalabo.com 配下のパス分け)
- キー: `katazuku-inbox/emails`、`katazuku-pipeline/companies`、`katazuku-pipeline/seeded`
- 新アプリも `katazuku-<app>/...` の命名で。別アプリのキーを読むのは可、**書く場合は既存データを
  壊さないマージにする**(inbox/src/lib/pipeline.ts(ファイル名は旧称)の「ステージは前進のみ」方式を踏襲)
- 企業名の名寄せは `status/src/lib/importer.ts` の sameCompany を使う(NFKC正規化・短名は完全一致)

## 外部連携

- 選考管理シート(Google Sheets, ID `1X6z04LUU5IHvzJLoKQiHpdc_ml21Dor3XDDdz9rWLx0`):
  読み書きルールは `status/src/lib/sheet.ts` に集約。**合格/不合格/辞退は上書きしない・
  メモ/数式列に触れない**が絶対条件
- 毎日同期: `scripts/daily-sync-prompt.md` が仕様(タスクスケジューラ→claude -p)。
  人事面談・Slack招待・インターン事前準備系のメールは最優先で、自動既読/削除の対象外
- 進捗報告: 大きな作業後は `docs/PROGRESS.md` を更新。ユーザー向けはGoogleシート
  「katazuku 開発進捗」(docs/PROGRESS.md冒頭にURL)

## 作法

- UI文言・コードコメント・コミットメッセージは日本語
- コミットは機能単位で。ビルド+全テスト通過を確認してからコミット
- 新機能の検証スクリプトは `scripts/check-*.ts`(tsx実行・依存ゼロの自前assert形式)に揃える
- 次に作るものは `docs/specs/` の番号順。仕様にないプロダクトを勝手に増やさない
