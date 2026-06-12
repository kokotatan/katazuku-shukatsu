# Spec 07: katazuku people (人脈整理)

## 目的

説明会・面談・インターンで出会った社員やOB/OGを記録し、「あの人誰だっけ」「お礼連絡したっけ」を
なくす。面接で「〇〇さんから伺った話ですが」と言えるのは強い。

## 要件

1. Prepアプリに「人」タブを追加する(新アプリは作らない。企業と人は対策の文脈で一緒に見るため)
2. データ: `katazuku-prep/people` (localStorage)
   ```ts
   interface Person {
     id: string
     name: string
     company: string      // 名寄せは lib/names.ts
     role: string         // 部署・肩書き
     metAt: string        // 出会った場面(「6/13 サマーインターン」)
     notes: string        // 話した内容・人柄・刺さった言葉
     followUp: boolean    // お礼・連絡が必要か
     updatedAt: string
   }
   ```
3. 機能: 企業別ノート画面にその企業の人を表示 / followUp=true の人をホームに「連絡待ち」として表示 /
   直前モードのデッキ末尾に「会う人の予習」としてその企業の人を出す
4. Todayとの連携(任意): followUpの人がいる場合、Todayの期限なしカウントの隣に「連絡待ちn人」を表示

## 受け入れ条件

- `prep/scripts/check-prep.ts` に人の名寄せ・followUp抽出のケースを追加して通過
- 人の情報がリポジトリに入らないこと(localStorageのみ)
