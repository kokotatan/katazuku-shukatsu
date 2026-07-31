カレンダー同期で「企業名を機械的に特定できなかった予定」だけを判定し、正本DBへ反映してください。

前提:
- 取得・正規化・DB反映の本体は既に決定的スクリプト(sync/scripts/calendar-fetch.ts)が済ませています。
  あなたの仕事は残りの判定だけです。カレンダーAPIやMCPは使いません。
- 入力は `sync/calendar-import-loop-residue.json`。形式は
  `{"events":[{externalId, calendarId, title, startAt, endAt?, location?, description?, url?}]}`
  残りには2種類あります:
  - `company` が無いもの: 「選考予定に見えるが、予定名にDB上の企業表記が無い」
    (例: 「リンモチ面接」=リンクアンドモチベーション、「バクラク ハッカソン」=LayerXの製品名)
  - `needsPosition: true` のもの: 企業は特定済みだが**選考トラックが複数あり position が要る**。
    `db-inspect.ts <企業名>` でトラック一覧を見て、予定名・説明から**どのトラックの予定か**を判定する
    (判定できなければ飛ばす。誤ったトラックに紐付けると選考状況が壊れる)。

手順:

1. `sync/calendar-import-loop-residue.json` を Read する。`events` が空なら何もせず手順5へ。
2. 各予定について、正本DBの企業と対応づけられるかを判定する。
   - `cd sync; npx tsx scripts/db-inspect.ts <語>` で候補を確認する。略称・製品名・サービス名から
     企業を引く(例: バクラク→LayerX、リンモチ→リンクアンドモチベーション)。
   - **DBに該当企業が無い、または確信が持てないものは飛ばす**。推測で別会社に結びつけない
     (誤った企業への紐付けは、選考状況を壊すため取り込まないより有害)。
   - 就活と無関係と判断したもの(授業・私用・他団体の活動)も飛ばす。
3. 対応づけられたものだけを `sync/calendar-import-resolved.json` へ次の形式で Write する:
   `{"events":[{"externalId","calendarId","title","startAt","endAt","company","position","kind","url","location","status"}]}`
   - `company` はDBに存在する正式名称そのまま。`kind` は 面接/面談/説明会/テスト/締切/その他 から選ぶ。
   - `needsPosition: true` だったものは `position` を必ず入れる(DBの既存トラックの表記と一致させる)。
   - `startAt`/`endAt`/`externalId`/`title` は入力の値をそのまま使う(作り直さない)。
4. `cd sync; npx tsx scripts/db-apply-calendar.ts calendar-import-resolved.json` を実行し、
   続けて `npx tsx scripts/db-snapshot.ts` を実行する。
5. **今後この判定が要らなくなるように、確信が持てた略称はDBの別名として登録する**:
   `npx tsx scripts/db-inspect.ts` で company_alias の有無を確認し、登録手段があれば
   「略称→企業」を追加する。手段が無ければ、サマリで「別名として登録すべき語」を列挙する。
6. 処理件数(反映/見送り)と、見送った理由を簡潔に出力する。最終行に単独で
   `=== calendar-residue DONE ===` と出力する。

注意:
- 事実を創作しない。日時・URLは入力の値だけを使う。
- 1件も反映できなくても正常終了でよい(次回また出てくる)。
