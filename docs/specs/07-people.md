# Spec 07: katazuku people (人脈整理)

> 【拡張 2026-07-16】(1)顔写真での記録(カオナビ的)、(2)出会った文脈の明示、
> (3)**選考管理/企業マスタから「前回この人とこんな話した」を顔付きで思い出せる**参照、を追記。
> 面接議事録(spec08 の `katazuku-interviews/notes`)と紐づけ、人=会話=企業を一本につなぐ。

## 目的

説明会・面談・面接・インターンで出会った社員やOB/OGを、**顔・出会った文脈・話した内容**とセットで記録し、
「あの人誰だっけ」「前回何を話したっけ」「お礼したっけ」をなくす。面接で「〇〇さんから伺った話ですが」と
言えるのは強い。**企業を開いたときに、会った人が顔付きで思い出せる**(カオナビのイメージ)状態にする。

## 要件

1. Prepアプリに「人」タブを追加する(新アプリは作らない。企業と人は対策の文脈で一緒に見るため)
2. データ: `katazuku-prep/people` (localStorage)
   ```ts
   interface Person {
     id: string
     name: string
     company: string            // 名寄せは sameCompany(status/src/lib/importer.ts)に統一
     role: string               // 部署・肩書き
     metAt: string              // 出会った場面(「6/13 サマーインターン」「7/16 二次面接」)
     howMet: string             // どこでどう会ったかの一言(カジュアル面談 / Meetで / 紹介 等)
     notes: string              // 人柄・刺さった言葉・関係性メモ
     facePhoto?: string         // 顔写真のローカル参照(dataURL or ファイル名)。第三者の個人情報→下記セキュリティ
     interviewNoteIds: string[] // 紐づく面接ノート(spec08 katazuku-interviews/notes)の id
     followUp: boolean          // お礼・連絡が必要か
     updatedAt: string
   }
   ```
3. **顔写真の取得(別途・軽量)**: 面接中に会議ウィンドウのスクショを数枚だけ間欠取得し(動画は録らない)、
   その中から相手の顔のコマを選んで `facePhoto` にする。自動顔検出は必須にしない(手動 or Claudeの目視選択でよい)。
   → 実装は `record-audio.ps1` と並走する軽量samplerとして別途。本specはデータと画面の定義に集中する。
4. 機能(人タブ):
   - 企業別に、その企業で会った人を **顔 + 名前 + 肩書き + 直近の会話(interviewNoteの要点)** で一覧
   - `followUp=true` の人をホームに「連絡待ち」として表示
   - 直前モードのデッキ末尾に「会う人の予習」としてその企業の人を出す
5. **選考管理/企業マスタからの参照(本拡張の肝)**: status(選考カンバン)の企業詳細(spec08で追加)に、
   その企業で会った人を **顔 + 「前回この人とこんな話した」(直近 interviewNote の highlights / firstPartyInfo)** 付きで表示。
   → 企業を開けば「**誰と・何を話したか**」が顔付きで即思い出せる。同じ相手との2回目以降の面談・面接に効く。
6. Todayとの連携(任意): followUpの人がいる場合、Todayの期限なしカウントの隣に「連絡待ちn人」を表示

## デザイン

CLAUDE.md のSmartHR Design System準拠(絵文字禁止・smarthr-ui第一・AppNav・値は defaultColor同値)。
顔写真は小さめの円形/角丸サムネイル。人物カードは罫線(`border-slate-300`)区切り。
空状態は「まだ登録した人はいない。」

## セキュリティ

- **顔写真・人物情報は第三者の個人情報**。localStorageのみに保存し、**gitに絶対入れない**
  (`people-export-*.json` と顔画像ファイルのパターンを gitignore に追加)。
- public/ に個人データを置く場合は `scripts/assemble.mjs` の除外処理にも必ず追加(本番漏洩防止)。
- **本人の備忘に限定**(社内共有・公開・配布はしない。カオナビのように組織で共有するものではない)。

## 受け入れ条件

- `prep/scripts/check-prep.ts` に、人の名寄せ・followUp抽出・interviewNote紐づけのケースを追加して通過
- 人の情報・顔写真がリポジトリに入らないこと(localStorage/ローカルのみ、gitignoreに反映)
- `npm run build` 通過
