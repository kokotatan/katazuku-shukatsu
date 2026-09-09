# 面談の事前調査と準備（定期処理・対話セッション共通）

予約・予定の登録を受けた時点から準備する。本人の追加依頼や面談48時間前を待たない。
既読/processedや前回の完了行で準備済みと判定しない。対象はDBの今後の面接・面談・説明会・座談会。
取消・終了した予定は対象外。テストの代行受験・課題の解答は行わない。

1. リポジトリ直下で `node sync/node_modules/tsx/dist/cli.mjs sync/scripts/meeting-preparation.ts list --write logs/meeting-preparation.local.json` を実行する。
   `items`が未完了全件。日時が近い順に処理する。停止期間中に登録された予定もここから拾う。
   定期処理では日時が近いものから1回最大3予定を処理し、残りは台帳に残して次回へ回す。
   一件が調査不能でも他の対象は進める。予約を扱う対話ではそのappointmentIdを処理する。会社やトラックを推測で新設しない。
   stdoutは要約。出力ファイルをJSONとして解析し、対象appointmentIdのpeople/pastInterviews/dossierだけを取り出して読む。
2. 企業研究が未作成・30日超の場合は `scripts/company-research-prompt.md` の調査とDB反映手順を実施する。
   Web検索で公式事業/製品/採用ページ、IR、公式技術ブログを確認し、取得日時とURLを残す。
   同じ会社の既存dossierは先に読み、裏付けのある既存事実・出典を保って更新する。
   調査済みの他トラックの情報を現在の採用条件と混同しない。1社の調査を同じ実行で何度も繰り返さない。
3. 面談相手の公開プロフィール・本人発信を確認する。氏名と会社が一致する根拠を使う。
   同定不能・非公開情報は創作せずunknownsへ書く。個人の私生活や不要な個人情報は調べない。
4. 前回のinterview_noteと文字起こし、関連event・元メール・会話台帳、個人マスタを読む。
   `pastInterviews`が空でも `logs/interviews/` 等に録音・文字起こしが残っていないか会社名/appointmentIdで確認する。
   録音が未反映なら、その事実を明記して既存の文字起こしから確認できる範囲を使う。
   本人の発言・仮説、会社から説明された事実、Webで検証した事実、面談で聞く問いを分ける。
5. 企業・相手・本人の志向に合わせて、面談の目的、逆質問3件以上、想定質問と回答の骨子3件以上を作る。
   回答素材には個人マスタ/前回記録等の根拠refを付け、経歴・経験・成果を創作しない。
   unknownsには調査しても分からない点を残す。公開情報で確認不能な点があるだけで全体を止めない。
6. dossier更新後に手順1を再実行し、現在のcontextHashを取得する。
   `logs/meeting-prep/<appointmentId>.local.json` に次のJSONを保存する（ディレクトリは必要なら作成）:

```json
{
  "appointmentId": 123,
  "contextHash": "listが返した64桁のhash",
  "preparedAt": "実際の確認日時ISO8601",
  "sourceRef": "meeting-prep:123:確認日時",
  "summary": "今回の面談で確認・伝達することを5分で読める要約",
  "counterpartResearch": "相手の役割・経歴・発信。未確認は未確認と明記",
  "priorContext": "前回までの話・宿題・本人の志向。根拠と仮説を区別",
  "questionsToAsk": ["企業と相手に即した逆質問1", "逆質問2", "逆質問3"],
  "anticipatedQuestions": [
    {"question":"想定質問1", "answerOutline":"本人の事実に基づく回答骨子", "evidenceRef":"既存の記録ref"},
    {"question":"想定質問2", "answerOutline":"回答骨子", "evidenceRef":"既存の記録ref"},
    {"question":"想定質問3", "answerOutline":"回答骨子", "evidenceRef":"既存の記録ref"}
  ],
  "sources": [{"title":"確認した一次資料", "url":"https://公式または本人のページ"}],
  "unknowns": ["面談で確認したい未確定事項"]
}
```

7. `node sync/node_modules/tsx/dist/cli.mjs sync/scripts/meeting-preparation.ts apply <JSON>` を実行する。
   根拠hash不一致は再調査して作り直す。エラーを無視してreadyにしない。
   DB書込み後は必ず `node sync/node_modules/tsx/dist/cli.mjs sync/scripts/db-snapshot.ts` を実行する。
   `/prep/?company=<企業名>` に準備資料が反映される。活動ログにも根拠資料と対象appointmentIdを記録する。
8. 通信・認証・資料不足などで完成できない場合は `... meeting-preparation.ts block --id <id> --reason <具体的な理由>`
   とsnapshotを実行し、次の定期処理へ残す。blockedを完了扱いしない。
9. 終了時にlistを再取得する。未完了件数・原因を報告に含め、単に「未調査なので本人が調べる」で終えない。
   完了後も日時・相手・前回記録・企業研究が変われば再準備する。48時間以内は最終確認も行う。
   カレンダーdescriptionの古い `--- prep ---` だけで再準備を省略しない。

この手順は調査と内部資料の保存まで。相手への送信・予約変更は別の承認済みExecutor契約に従う。
