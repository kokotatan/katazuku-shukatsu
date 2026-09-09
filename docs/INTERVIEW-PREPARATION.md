# 面談の事前調査と準備

## 期待する動作

予定の登録日から、本人の追加依頼なしで企業・相手を調べ、前回までの文脈と想定問答を揃える。
48時間前は初回調査の開始日ではなく、最新情報を確認し直す時点とする。

## 2026-09-09の修正

旧実装では朝のプロンプトの「48時間以内」だけが自動準備の入口だった。前夜ブリーフは企業研究がなければ
「未調査」と表示して本人へ確認を促し、データ集約CLIもcompany_dossierを含めていなかった。
準備資料の存在確認・未完了の永続化・再試行対象の再評価がなく、メールの送信やセンチネルだけで正常扱いできた。

- `sync/src/meeting-preparation.ts`: 予定・選考・会社・相手・過去記録・プロフィール・dossierを照合する。
- `appointment_preparation`: 予定ごとの準備JSONと根拠hashを正本DBに保存する。未作成は予定から常に導出する。
- `scripts/meeting-preparation-prompt.md`: 対話・朝・前夜で共通の調査手順。予定を扱った対話では同じ作業内に実施する。
- `calendar-sync.ps1`: 同期後に準備待ちを全件再評価し、台帳と専用アラートへ反映する。同期中には追加のLLMを起動しない。
- `asa-auto.ps1` / `evening-brief.ps1`: 前後に決定論検査を実行。未完了は報告し、次回へ残す。朝は9:00、前夜は登録済みタスクの時刻。
  停止後の大量の未完了で定例報告を塞がないよう、1回の調査は日時順に最大3予定。未完了が残れば準備検査は非0を返す。
- `brief-data.ts`: dossierと面談準備をブリーフへ渡す。
- snapshot / Prep: 有効な準備だけを表示し、再確認が必要な資料をreadyとして配信しない。

## 完了条件と再評価

企業研究の要約とHTTP(S)出典、30日以内の確認日時が必要。
面談準備には要約、相手情報（未確認はその旨）、前回文脈、逆質問3件以上、根拠付き回答骨子3件以上、出典を要求する。
件数・schema・根拠hashの検査は事実の正確さを証明しないため、調査担当は一次資料を実際に読み、推論と事実を分ける。

日時・相手・選考段階・過去記録・プロフィール・dossierが変わると再準備する。
面談まで48時間以内で確認が48時間より古ければ最終確認する。完了済みでも30日超なら再確認する。
取消・過去・終了選考は除外。適性検査・コーディングテストの代行は対象外。

障害はblockedと理由を記録して残し、翌実行時にもpendingとして返す。完了行だけではガードを通らない。
別トラックの面談を一括で完了にしない。DBへの保存後は必ずsnapshotをプッシュする。

```powershell
node sync/node_modules/tsx/dist/cli.mjs sync/scripts/meeting-preparation.ts list
node sync/node_modules/tsx/dist/cli.mjs sync/scripts/meeting-preparation.ts apply logs/meeting-prep/123.local.json
node sync/node_modules/tsx/dist/cli.mjs sync/scripts/db-snapshot.ts
node sync/node_modules/tsx/dist/cli.mjs sync/scripts/meeting-preparation.ts check
```

`check`は未完了0件でexit 0、未完了ありでexit 2、検査失敗で非0。台帳生成自体が失敗した場合も正常扱いしない。
テストは `sync/scripts/check-meeting-preparation.ts`。既存の `check:db` とルートの `npm run build` に含める。

## 運用上の前提

定期処理の停止中は実行されない。MiniPC停止と緊急正本リース失効は調査ロジックとは別の障害として扱う。
ノートPCでの暫定復旧は `docs/EMERGENCY-FAILOVER.md` のリースとガードを守り、二重正本を作らない。
この修正は準備の検査と内部保存であり、相手へのメール送信・予約変更の承認境界は変えない。
