# katazuku — 就活プロダクト群

就活生・奥山彪太郎さん個人のためのプロダクト群。ユーザーは本人ただ一人。
「散らかった就活タスクを気持ちよく片付ける」が全プロダクト共通の目的。

## 構成

```
landing/          トップページ (katazuku.kotalab.com 予定)
inbox/            メール自動仕分けSPA      → /inbox/
pipeline/         選考管理カンバン          → /pipeline/
api/              Vercel Functions (これから。specs/01参照)
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
npm --prefix pipeline run dev      # Pipeline 開発サーバー

# テスト (全部通すこと。新機能には同形式の check-*.ts を追加する)
cd inbox;    npx tsx scripts/check-classify.ts    # 実メール50件の分類検証 (目視確認用)
cd inbox;    npx tsx scripts/check-actions.ts     # アクション抽出
cd inbox;    npx tsx scripts/check-selection.ts   # 選考/募集/課外/宣伝の判定
cd inbox;    npx tsx scripts/check-pipeline.ts    # Inbox→Pipeline連携
cd pipeline; npx tsx scripts/check-import.ts      # シート取込マージ
cd pipeline; npx tsx scripts/check-sheet.ts       # シート書き戻し
```

## デザインシステム「帳簿的ミニマリズム」(厳守)

- **絵文字は全面禁止**(UI・コード・コミットメッセージとも)。アイコンが要るならテキストか字形で
- 配色はトークンで管理 (`inbox/src/index.css` と `pipeline/src/index.css` は同一内容を保つ):
  - `slate-*` = 紙とインクのウォームグレー(青みグレー禁止)
  - `red-*` = 朱。**締切・要対応・エラーの警告専用**。装飾に使わない
  - アクセントは `slate-900`(墨色)の塗りのみ。紫・緑・青・黄などの追加色は禁止
- 見出し・大きい数字・ブランドは `font-display`(しっぽり明朝)。本文はゴシック(可読性優先)
- ブランドマークは「片」一字の黒角印(Header実装を参照してコピーする)
- 角丸は控えめ(トークンで上書き済み)。影よりも罫線(hairline border)で区切る
- 中央寄せヒーロー・3等分カード・グラデーションなどの「AIっぽい定型」を避ける。
  参考スキル: `~/.agents/skills/design-taste-frontend/SKILL.md`(TasteSkill。ランディング系のみ適用)

## データとセキュリティ(最重要)

以下は個人情報・秘密情報。**gitに絶対コミットしない**(gitignore済み。新パターンを作ったら必ず追記):
- `inbox/gmail-import-*.json`・`inbox/public/gmail-import-auto.json`(実メール)
- `pipeline/sheet-import-*.json`(選考状況)
- `pipeline/service-account.json`(Google SA鍵)
- `logs/`、`*.local.md`、`notify-*.json`

`scripts/assemble.mjs` は配信物 `dist/` から個人データを除外する。**新しい個人データファイルを
public/ に置く場合は assemble.mjs の除外処理にも必ず追加すること**(漏れると本番公開で漏洩する)。

## アプリ間連携の決まり

- 同一オリジン前提のlocalStorage共有で連携する(本番は katazuku.kotalab.com 配下のパス分け)
- キー: `katazuku-inbox/emails`、`katazuku-pipeline/companies`、`katazuku-pipeline/seeded`
- 新アプリも `katazuku-<app>/...` の命名で。別アプリのキーを読むのは可、**書く場合は既存データを
  壊さないマージにする**(inbox/src/lib/pipeline.ts の「ステージは前進のみ」方式を踏襲)
- 企業名の名寄せは `pipeline/src/lib/importer.ts` の sameCompany を使う(NFKC正規化・短名は完全一致)

## 外部連携

- 選考管理シート(Google Sheets, ID `1X6z04LUU5IHvzJLoKQiHpdc_ml21Dor3XDDdz9rWLx0`):
  読み書きルールは `pipeline/src/lib/sheet.ts` に集約。**合格/不合格/辞退は上書きしない・
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
