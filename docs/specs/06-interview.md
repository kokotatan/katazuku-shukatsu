# Spec 06: katazuku interview (面接ログ)

## 目的

面接・面談の録音(スマホ)から構造化メモを作り、Prepの振り返りに自動で積む。
記憶が新しいうちの手書きに頼らない。

## 要件

1. 入力: 音声ファイル(m4a/mp3)を `interview-inbox/`(gitignore)に置く運用
2. `scripts/interview-log.ps1 <音声ファイル> <企業名>`:
   - 文字起こし: ローカルwhisper(`whisper.cpp` または `npx @xenova/transformers` 等、無料・ローカル完結)
     ※Claude APIは音声を受けないため文字起こしは別段で行う
   - 構造化: 文字起こしテキストを `claude -p` に渡し、次のJSONを生成
     `{ company, date, questions: [{question, myAnswer, impression}], retro: {良かった点, 突かれた点, 次への一手}, followUps: [] }`
   - 出力: `prep` のlocalStorageに直接は書けないので、Prepのインポート形式
     `prep-import-<date>.json`(gitignore)を生成し、Prepアプリにインポート機能を追加して取り込む
3. Prepアプリに「インポート」ボタンを追加(他アプリと同形式、IDで重複排除)
4. 録音は相手の同意・社内規定に配慮する旨をREADMEに明記

## 受け入れ条件

- サンプル音声(自分の声でよい)で、録音→文字起こし→構造化→Prepに振り返りが入るまでが通る
- 音声・文字起こし・生成JSONのすべてがgitignoreされている
