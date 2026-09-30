カレンダー同期のうち「企業名を機械的に特定できなかった予定」だけを判定し、正本DBへ反映してください。

前提:
- 取得・正規化・DB反映の本体は、決定的スクリプト(scripts/calendar-fetch.ts)が済ませています。
  あなたの仕事は残りの判定だけです。カレンダーAPIやMCPは使いません。
- 入力は次のJSONです。2種類あります:
  - `company` が無いもの: 選考予定に見えるが、予定名にDB上の企業表記が無い(略称・製品名だけで書かれた予定など)
  - `needsPosition: true` のもの: 企業は特定済みだが選考トラックが複数あり、position が要る

```json
{{RESIDUE}}
```

手順:

1. 各予定について、`npm run quick -- status <語>` で正本DBの企業・トラックを確認し、対応づけられるか判定する。
   - **DBに該当企業が無い、または確信が持てないものは飛ばす**。推測で別会社に結びつけない
     (誤った紐付けは、取り込まないより有害)。就活と無関係な予定(授業・私用)も飛ばす。
   - `needsPosition` のものは、予定名・説明からどのトラックの予定かを判定する。判定できなければ飛ばす。
2. 対応づけられたものだけを `logs/calendar-resolved.local.json` へ次の形式で書く:
   `{"events":[{"externalId","calendarId","title","startAt","endAt","company","position","kind","url","location","status"}]}`
   - company はDBに存在する名称そのまま。kind は 面接/面談/説明会/テスト/締切/その他。
   - startAt / endAt / externalId / title は入力の値をそのまま使う。
3. `npx tsx src/db-apply-calendar.ts logs/calendar-resolved.local.json` を実行する。
4. 反映件数と見送った理由を簡潔に出力し、確信を持てた略称があれば「別名として登録すべき語」として列挙する。
   最終行に単独で `{{SENTINEL}}` と出力する。1件も反映できなくても正常終了でよい(次回また出てくる)。
