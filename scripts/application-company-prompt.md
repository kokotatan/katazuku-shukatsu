# 会社名だけで開始する応募自動運転

COMPANYの企業研究から、応募、適性検査を本人が受けられる状態、または面接予定の確定までを、同じ応募runとして進めてください。

最初に次をすべて読んでから実行します。

- `AGENTS.md`
- `CLAUDE.md`
- `scripts/company-research-prompt.md`
- `chrome-prompts/08-browser-entry-knowhow.md`
- `chrome-prompts/09-application-autopilot.md`
- `docs/specs/11-application-autopilot.md`
- `schemas/application-start.schema.json`
- `schemas/application-event.schema.json`

## 実行順序

1. COMPANYを公式サイトの表記へ名寄せする。28卒新卒採用を公式採用サイトで確認し、POSITIONが空で複数コースがある場合は、応募を始める前に本人へ選択を求める。募集が未開始・終了・対象外の場合は作り話で進めず、根拠URLとともに停止する。
2. `scripts/company-research-prompt.md`に従って一次情報中心の企業研究を行い、`company_dossier`へ反映する。通常の企業研究に加え、公式新卒採用ページ、募集職種、選考フロー、応募期限、公式エントリーURLも調べる。DBを書いたらsnapshotと活動ログまで実行する。
3. `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/application-autopilot.ps1 -Action list`で既存runを確認する。SOURCE_REFが同じrun、または会社と確定POSITIONが同じ未完了runがあれば再開し、新しいrunを重複作成しない。複数runが候補なら本人に選択を求める。paused/failedなら、停止理由を解決してから`resumed`を記録する。
4. 新規runなら、公式エントリーURL、確定したPOSITION、MATERIALS_REFを使って`application-start.schema.json`準拠の一時JSONを`logs/`以下に作り、`application-autopilot.ps1 -Action start`で開始する。POSITIONが空のまま一意に確定した場合は、COMPANY、確定POSITION、SEASONから同じSHA-256規則で実際のsourceRefを作り、POSITION未確定時のSOURCE_REFを複数職種で使い回さない。
5. 現在ログイン済みのChromeを使い、`09-application-autopilot.md`のとおりにフォームを進める。集約サイトではなく公式応募経路を使う。既存のプロフィールと完成済みESを正確に転記し、推測で補完しない。
6. エントリーまたはESの送信直前に、送信対象の画面内容を本人へ提示する。同じ実行中に、その案件へ
   「送って」「提出して」「任せる」等の明示承認を得た場合だけ送信し、`approvedByUser:true`の提出イベントを記録する。
   「この日程で」「④だけ」等の内容指定を送信承認と解釈せず、過去・別案件の包括承認も流用しない。
   送信直前に既存run、提出イベント、受付画面・確認メールを再照合し、同じsourceRefと内容で成功済みなら再送信しない。
   成否不明の場合も再実行せず、本人へ報告して停止する。
7. パスワード、メール認証、SMS、CAPTCHAは本人へ引き継ぎ、完了後に続行する。認証情報はファイル、DB、ログへ保存しない。
8. 提出後に適性検査がある場合は、種類、提供元、URL、期限、所要時間、持ち物、環境だけを整理し、`assessment_ready`まで進める。問題や解答を保存・生成・入力せず、受検開始直前で本人へ引き継ぐ。受検完了は本人の申告後だけ記録する。
9. 面接候補が提示された場合、まず `scripts/calendar-sync.ps1` を成功させ、候補ごとに正本DBへ
   `cd sync; npx tsx scripts/db-appointment.ts conflicts <開始ISO> <終了ISO>` を実行する。
   `state: "available"`、`available: true`、`database.role: "canonical"` かつ本人が事前指定した可能時間帯の中だけ予約する。
   `unknown`、範囲外、設定なし、DB衝突ありなら候補を提示して確認し、確定後に`interview_scheduled`とappointmentを記録する。
10. 後日のメール待ちになった場合は、現在の正確なstate、次に自動で拾う内容、本人が行うことを簡潔に報告して終了する。daily-syncが適性検査案内と面接確定メールを同じrunへ反映する。

## 完了条件

- 企業研究dossierと根拠URLがDBにある
- 応募runとブラウザ上の進捗が一致している
- DB更新後に`cd sync; npx tsx scripts/db-snapshot.ts`を実行済み
- 自律処理を活動ログへ記録済み
- 本人だけが行える工程を代行していない

最後に、会社名、応募職種、応募runのstate、提出済みか、適性検査の状態、面接予定、本人が次にすることを報告してください。全工程を正常に記録できたときだけ最終行へ単独で`=== application-company DONE ===`と出力します。
