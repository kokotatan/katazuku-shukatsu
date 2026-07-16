# Spec 08: Katazuku Data(就活データ基盤とその活かし)

> 【前提 2026-07-16】面接録音→文字起こし→構造化ノートのパイプライン(`scripts/record-audio.ps1`
> + `scripts/interview-digest.ps1` → `chrome-prompts/interview-notes.local.md`)は稼働済み。
> ただし議事録は `.local.md` に貯まるだけで**Claudeしか読めず、アプリからは使えない**。
> 本specはこの新しいデータ層を含めて「企業」軸で横断結合し、アプリで活かすところを定義する。
> spec06(interview)の後半=「取込・活用」に相当。新しい取得元・バックエンドは作らない。

## 目的

katazukuの就活データは今、アプリ/ファイルごとにサイロ化している(inboxメール・pipeline企業・
面接議事録・profileスニペット・カレンダー)。これらを**「企業」を軸に読み取り専用で横断結合**し、
1社ぶんの全体像(選考段階・関連メール・面接で話したこと・懸念・締切・使ったES部品)を
1画面で見られるようにする。**既にある素材を"つなぐ"だけ**で、新規収集はしない。

## 基盤(データ層)

1. **面接議事録をアプリ可読にする**: `interview-digest` が、構造化ノートを `.local.md` への追記に加えて
   localStorageキー `katazuku-interviews/notes` にも JSON で載せられるようにする(PC↔ブラウザは
   他アプリと同じエクスポート/インポートJSON方式を踏襲。新しい注入経路は作らない)。
   ```ts
   interface InterviewNote {
     id: string
     company: string          // 表記ゆれは sameCompany で名寄せ
     date: string             // YYYY-MM-DD
     kind: string             // カジュアル面談 | 一次 | 二次 | 最終 | 人事 等
     interviewer?: string
     asked: string[]          // 聞かれたこと(想定質問の蓄積=用途1)
     highlights: string[]     // 話したこと・自己分析素材(用途4/5)
     firstPartyInfo: string[] // 相手が話した一次情報(用途2/4)
     concerns: string[]       // 懸念フラグ(次選考で潰す=用途2)
     nextActions: string[]
     source: string           // logs/interviews/<...>.txt への参照
   }
   ```
2. **横断結合ライブラリ** `status/src/lib/basin.ts`: 「企業」をキーに、次を read-only で束ねた
   集約レコードを返す。企業名の名寄せは `status/src/lib/importer.ts` の `sameCompany`(NFKC・短名完全一致)。
   - `katazuku-pipeline/companies`(選考段階・nextDate)
   - `katazuku-inbox/emails`(その企業の要対応メール・締切)
   - `katazuku-interviews/notes`(面接ノート)
   - profile(notes)スニペットの `usedAt`(その企業で使ったES部品)
   - **結合は純粋な読み取りのみ。他アプリのキーには書かない**(アプリ間連携の大原則)。

## 活かし(消費)— 新アプリは作らない

3. 既存 **status(選考カンバン)に「企業詳細」を追加**。カードを開くと統合タイムライン:
   - 選考段階の履歴 / 関連メール(inboxへ遷移)/ 面接ノート / 締切 / 使ったES部品(profileへ遷移)
   - **「懸念フラグ」と「ネクストアクション」を上部固定**(次選考の対策に直結)
4. **insight(今日やること)** に、面接ノートの `nextActions` のうち期限付きを合流(spec02の集約に1ソース足すだけ)。

## デザイン

CLAUDE.md のSmartHR Design System準拠(絵文字禁止・smarthr-ui第一・AppNav・値は defaultColor同値)。
企業詳細は smarthr-ui の Dialog/Drawer系で。懸念=`red-*` は警告専用の用途に合致するので可。

## セキュリティ

- 面接ノート・メールは個人情報。**localStorageのみ**。エクスポートJSONは gitignore パターン
  `interviews-export-*.json` を追加。
- public/ に個人データを置く場合は `scripts/assemble.mjs` の除外処理にも必ず追加(本番漏洩防止)。

## 受け入れ条件

- `status/scripts/check-basin.ts`(名寄せ・結合・重複排除・空データの単体テスト。tsx/自前assert形式)を追加し通過。
- `interview-digest` の localStorage 書き出し(JSON整形)を検証する形を用意。
- `npm run build` 通過。新規個人データパターンを gitignore と assemble.mjs 除外へ反映。
- 既存アプリの localStorage を壊さないこと(結合は読み取りのみ)をテストで担保。

## やらないこと(スコープ外)

- バックエンド/DB/新規スクレイピングは作らない。
- 他アプリの localStorage キーへの書き込みはしない(読み取り結合のみ)。
- 新SPAは増やさない(既存 status への追加に留める)。
