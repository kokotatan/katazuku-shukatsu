# Spec 03: Katazuku Notes (ES・ガクチカの部品庫)

> 【実装済み・注記 2026-07-10】本specは実装完了。フォルダ名は命名統一(2026-06-13)で
> `notes/` → `profile/`(URL `/profile/`)に改名済み。spec05の「profile(個人マスタJSON)」とは
> 別物なので注意。以下の旧名は当時の記述のまま。

## 目的

ESの設問は会社が違っても中身は同じ(ガクチカ/研究概要/自己PR/志望動機の型)。
書いた文章を「部品」として貯めて、文字数指定に合わせて使い回せるようにする。
LabBaseの調査でも先輩院生の54%が「研究概要を使い回せる形で整理」していた、まさにそれ。

## 要件

1. 新アプリ `notes/`(構成・組み込み方はSpec 02と同じ。base `/notes/`)
2. データ: `katazuku-notes/snippets` (localStorage)
   ```ts
   interface Snippet {
     id: string
     /** 種別: gakuchika | research | jikoPR | shibou | other */
     kind: string
     title: string          // 「LayerXハッカソンの話」など
     body: string
     /** 使った企業名のメモ */
     usedAt: string[]
     updatedAt: string
   }
   ```
3. 機能:
   - 種別タブ(ガクチカ/研究概要/自己PR/志望動機/その他)でスニペット一覧
   - 編集画面: 本文textarea + **常時表示の文字数カウンタ**(全角換算)。
     目標文字数を入力すると「あと◯字」「◯字オーバー」を朱で表示(400字・600字のプリセット)
   - スニペットの複製(「600字版から400字版を作る」フロー)
   - 「この企業で使った」記録(usedAt に企業名追加。候補は `katazuku-pipeline/companies` から補完)
   - JSONエクスポート/インポート(他アプリと同形式のボタン)
4. ES本文は個人情報だが localStorage のみなのでリポジトリには入らない。
   エクスポートしたJSONは gitignore パターン `notes-export-*.json` を追加して保護

## デザイン

CLAUDE.md 準拠。書くことに集中できる画面(エディタは1カラム・最大幅 65ch・余白広め)。
文字数カウンタは font-display の tabular数字。

## 受け入れ条件

- 文字数カウントのロジック(改行・空白の扱い、全角換算)を `notes/scripts/check-count.ts` で検証
- `npm run build` 通過、landing に「〇四」として追加
