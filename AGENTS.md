# katazuku — エージェント向け指示 (Codex ほか)

**最初に必ずリポジトリ直下の `CLAUDE.md` を読むこと。** プロジェクト全体の構成・コマンド・
デザインシステム・セキュリティ規約はそこに集約されている。本ファイルは要点の再掲のみ。

## 絶対に守ること

1. **絵文字禁止**(UI・コード・コミットとも)。配色は `inbox/src/index.css` のトークンのみ
   (紙とインクのウォームグレー + 朱は警告専用)。見出しは `font-display`(しっぽり明朝)
2. **個人情報をコミットしない**: `gmail-import-*.json` / `sheet-import-*.json` /
   `service-account.json` / `logs/` / `*.local.md`。public/ に個人データを置くときは
   `scripts/assemble.mjs` の除外処理にも追加(漏れると本番公開で漏洩)
3. 完了条件は **`npm run build` 通過 + `scripts/check-*.ts` 全テスト通過**(実行方法はCLAUDE.md)。
   新機能には同形式の check スクリプトを足す
4. UI文言・コメント・コミットメッセージは日本語
5. 実装するのは `docs/specs/` の番号順(01: 返信API → 02: Today → 03: Notes → 04: Prep)。
   仕様にないプロダクトを勝手に増やさない
6. アプリはバックエンドなし・localStorage永続化(`katazuku-<app>/...` キー)。例外は `api/` のみ。
   他アプリのデータへ書くときは既存を壊さないマージ(`inbox/src/lib/pipeline.ts` 参照)

## 環境

- Windows 11 / PowerShell。Node 20+。`npm run build` がルートの一括ビルド
- 開発サーバー: `npm --prefix inbox run dev`(他アプリも同様)
- 選考管理シートへの書き込みは `pipeline/src/lib/sheet.ts` の安全ルールを必ず経由
  (合格/不合格/辞退・メモ・数式列は不可侵)
