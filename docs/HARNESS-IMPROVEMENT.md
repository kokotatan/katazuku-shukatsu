# エージェントハーネスと自己改善ループ

katazukuの自己改善は、実行中のモデルが本番コードやプロンプトを直接書き換える仕組みではない。実行台帳から失敗を観測し、合成回帰fixture、改善候補、baseline比較eval、本人レビュー可能な昇格候補へ変換するControl Planeである。

## 参考にした設計

- Anthropicのlong-running harness: initializer、段階的な進行、セッション間の構造化成果物、生成者と評価者の分離
  - https://www.anthropic.com/research/effective-harnesses-for-long-running-agents
  - https://www.anthropic.com/research/harness-design-long-running-apps
- OpenAIのagent evals: tool call・guardrail・handoffを含むtrace、grader、dataset、反復可能なeval run
  - https://developers.openai.com/api/docs/guides/agent-evals
  - https://developers.openai.com/cookbook/examples/agents_sdk/agent_improvement_loop
- Microsoft Agent Framework: provider非依存のEvalItem、Evaluator、EvalResultsとworkflow評価
  - https://learn.microsoft.com/en-us/agent-framework/agents/evaluation
- Google Cloudのagent observability: model、tool、latency、error、品質評価を一つの運用面で観測
  - https://docs.cloud.google.com/stackdriver/docs/observability/agent-observability
- Vercel eve: checkpoint済みのdurable session、sandbox、human-in-the-loop、コード化したeval
  - https://vercel.com/blog/introducing-eve

katazukuは既存のローカルファースト基盤をeveへ置き換えない。上記の共通原則を、正本SQLite、workflow契約、provider failover、本人承認、外部状態reconcileへ適用する。

## 二つのループ

### 実行ループ

1. workflow契約と正本identityを固定する。
2. provider preflightで能力、認証、利用枠を検査する。
3. モデル工程は構造化出力まで、Executor工程は決定論的副作用までに分ける。
4. stepごとにcheckpointし、再開時は同じrun IDと外部状態を照合する。
5. `unknown`、本人操作待ち、承認待ちは成功や失敗へ丸めない。

### 改善ループ

```text
run台帳 → 最小観測 → 失敗cluster → 合成回帰case → 改善候補
       → baseline/candidate eval → safety gate → 人手レビュー → revision昇格
```

`src/harness-improvement.ts`の改善DBは正本DBと分離する。保存するのはworkflow、結果、failure分類、副作用状態、provider、attempt数、failover数、時間であり、prompt、出力本文、メール本文、資格情報、個人プロフィール、ローカルartifact pathは複製しない。

失敗runは実データをコピーせず、同じ契約違反を再現する`synthetic:` fixture参照へ変換する。外部副作用が`unknown`になったcaseは常にsafety caseであり、自動再送しないことを期待値に持つ。

## 候補の評価と昇格

候補は最低3 caseかつsafety caseを含む固定evalで比較する。

- 必須caseをすべて通す。
- safety caseをすべて通す。
- baselineで成功したcaseを失敗へ戻さない。
- 平均品質scoreを下げない。
- 25%を超える遅延増加は、明確な品質向上がなければ拒否する。

合格しても状態は`evaluated`であり、自動deployしない。人が候補内容と実際のGit revisionを確認した場合だけ`approved`へ進める。さらに安定版baselineとcandidateのbase revisionが一致し、呼出側が現在revisionを明示した場合だけ`activate`できる。外部送信、予約、応募提出、資格情報、承認境界に関する候補は常に高リスクとして扱う。

## 運用コマンド

既存run台帳の取り込みと集計は、正本DBではなく分離した改善DBへ書き込む。

```powershell
npm run harness:improve -- scan --artifacts logs/agent-runs
npm run harness:improve -- report
```

`scan`は各runディレクトリ直下の`run.local.json`だけを最大1 MiBで読み、run IDで冪等化する。artifact本文、prompt、出力本文は読まない。破損台帳は他のrunを止めず`invalid`へ数える。

改善候補と固定evalはJSONファイルから明示的に登録する。

```powershell
npm run harness:improve -- propose .\candidate.json
npm run harness:improve -- evaluate <candidate-id> .\eval.json
npm run harness:improve -- approve <candidate-id> <git-revision> --approved-by <確認者>
```

`approve`は評価合格済み候補だけを対象にし、確認者と実Git revisionの両方を要求する。定期処理がこのcommandを呼んではならない。

最初に既知の安定版を1回だけ登録し、承認済みrevisionを明示的に昇格する。

```powershell
npm run harness:improve -- baseline <stable-revision> --registered-by <確認者>
npm run harness:improve -- activate <candidate-id> --expected-revision <stable-revision> --activated-by <確認者>
npm run harness:improve -- release
```

`activate`はcandidate作成時のbase revision、現在の安定版、`--expected-revision`の三者が一致しないと停止する。これは並行する改善候補が古いbaselineを上書きするのを防ぐ楽観ロックである。実際のGit checkoutやproduction deployは別のCI/CDが、この台帳と同じrevisionを照合して行う。

退行時は任意のrevisionへ飛ばさず、直前の安定版へだけ戻す。

```powershell
npm run harness:improve -- rollback --expected-revision <current-revision> --rolled-back-by <確認者> --reason <理由>
```

baseline、昇格、rollbackは追記専用イベントにも残る。自動判定は候補を`evaluated`まで進められるが、`approve`、`activate`、`rollback`は運用責任者の明示操作である。

## 今後の接続

`run.local.json`の冪等取り込みと、失敗signatureからの合成回帰case生成までは実装済みである。次に接続する範囲は以下とする。

1. CIでbaseline revisionとcandidate revisionを同じfixture群へ実行する。
2. eval結果と費用・時間を候補へ記録する。
3. deployment側でrelease台帳のrevisionと実行artifactの署名を照合し、段階的なcanary観測を行う。

改善DBやeval結果だけを根拠に、正本DB、外部サービス、production prompt、workflow契約を自動変更してはならない。
