# Spec 05: katazuku profile (個人マスタ)

## 目的

氏名・学歴・連絡先・ESの定型データを一元管理し、各所(ブラウザ操作プロンプト・返信署名・Notes)が
同じマスタを参照するようにする。現状は `chrome-prompts/_profile.local.md`(手書きmd)が事実上のマスタ。

## 要件

1. マスタを `profile.local.json` (リポジトリ直下、gitignore追加) に正規化:
   氏名/かな/メール/電話/大学/研究科/専攻/研究室/学年/卒業年/住所(任意)/緊急連絡先(任意)
2. 変換スクリプト `scripts/profile-render.ts`: JSONから以下を生成
   - `chrome-prompts/_profile.local.md`(既存形式)
   - `inbox/vite.claude-reply.ts` が参照する署名(直書きの氏名・署名をJSON参照に置き換える)
3. `katazuku profile` (scripts/katazuku.ps1) はJSONを開き、保存後に変換スクリプトを実行する形に更新
4. 個人情報なので JSON・生成物ともコミット禁止(gitignore徹底)

## 受け入れ条件

- JSONを1箇所直すと、プロンプト用mdと返信署名の両方に反映される
- `scripts/check-profile.ts` で変換の単体検証
