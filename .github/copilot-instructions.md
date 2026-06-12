# katazuku プロジェクト指示 (GitHub Copilot 用)

詳細はリポジトリ直下の `CLAUDE.md` と `docs/specs/` を参照。以下は常時適用のルール。

- 就活生個人のためのプロダクト群。Vite + React 19 + TypeScript + Tailwind v4。
  バックエンドなし・localStorage永続化(キーは `katazuku-<app>/...`)。例外は `api/`(Vercel Functions)のみ
- **絵文字は禁止**(UI・コード・コミットすべて)。UI文言・コメント・コミットメッセージは日本語
- デザインは「帳簿的ミニマリズム」: 配色は `inbox/src/index.css` のトークンだけを使う
  (ウォームグレー基調、`red-*`=朱は締切・要対応・エラー専用、アクセントは `slate-900` の塗りのみ)。
  見出し・大きな数字は `font-display`(しっぽり明朝)。中央寄せヒーローや3等分カード等の定型を避ける
- **個人情報をコミットしない**: `gmail-import-*.json`, `sheet-import-*.json`,
  `service-account.json`, `logs/`, `*.local.md` はgitignore対象。新しい個人データファイルを
  追加するときは `.gitignore` と `scripts/assemble.mjs` の除外処理の両方を更新する
- 完了条件: `npm run build` 通過 + `inbox/scripts/` `pipeline/scripts/` の `check-*.ts` 全通過。
  新機能には同形式(tsx実行・自前assert)の検証スクリプトを追加する
- 実装順は `docs/specs/01〜04`。企業名の名寄せは `pipeline/src/lib/importer.ts` の
  `sameCompany` を再利用。選考管理シートへの書き込みは `pipeline/src/lib/sheet.ts` 経由のみ
