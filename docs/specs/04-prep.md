# Spec 04: Katazuku Prep (面接の振り返りと想定問答)

## 目的

面接の敗因が記録から見えている(例: 「意思決定していないことを突かれた」「フランクに話しすぎた」
「結論ファーストで発表できず」)のに、次の面接前に見返す場所がない。
企業ごとの「振り返り」と「想定問答」を貯めて、**面接直前に5分で読む画面**を作る。

## 要件

1. 新アプリ `prep/`(構成はSpec 02と同じ。base `/prep/`)
2. データ: `katazuku-prep/entries` (localStorage)
   ```ts
   interface PrepEntry {
     id: string
     company: string        // pipeline企業名から補完(名寄せは importer.ts の sameCompany 流用)
     /** kind: retro(振り返り) | qa(想定問答) | axis(就活の軸) */
     kind: string
     question: string       // qa: 想定質問 / retro: 場面 / axis: テーマ
     answer: string         // 自分の答え・反省・次にどうするか
     updatedAt: string
   }
   ```
3. 機能:
   - 企業別ビュー: その企業の retro + qa を1画面に(面接直前に開くページ)
   - 「直前モード」: 選んだ企業の axis(共通の軸)+ qa を大きい文字で1問ずつ表示(Jキーで次へ)
   - 横断ビュー: kind=retro を時系列で。同じ失敗の繰り返しが見えるように
   - 初期データ: `pipeline/sheet-import-2026-06-12.json` のmemoから振り返りを起こした
     シードを **コード内に置かず** `prep/seed-example.json`(gitignore)として手元生成する手順をREADMEに
4. Pipeline連携: PipelineのCompanyModalに「対策ノートへ」リンク(/prep/?company=企業名)を追加

## デザイン

CLAUDE.md 準拠。直前モードは紙色の地に明朝の大きな設問だけが出る、緊張がほどける画面に。

## 受け入れ条件

- 名寄せ・ソートロジックの `prep/scripts/check-prep.ts` 通過
- `npm run build` 通過、landing に「〇五」として追加
- 個人の振り返り内容がリポジトリに入っていないこと
