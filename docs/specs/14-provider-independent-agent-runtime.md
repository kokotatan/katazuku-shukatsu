# Spec 14: モデル非依存エージェント実行基盤

最終更新: 2026-07-19

## 目的

Claude、Codex、ローカルOSSモデルのどれか1つを前提にせず、同じ就活workflowを
利用可能な実行役で安全に継続できるようにする。Claudeの利用枠切れ、認証切れ、接続障害などで
定常処理全体が止まる状態を解消し、OSS版でも利用者がモデルと実行環境を選べる構造にする。

ここで交換可能にするのは推論・ツール選択を行うagent層である。DB遷移規則、承認ゲート、
冪等化、入力検証、外部サービスへの確定反映はモデルへ委ねず、共通の決定論的な層に置く。

## 設計判断

- workflowはprovider名ではなく、目的、入力、必要capability、出力schema、承認点、完了条件を宣言する
- `katazuku-agent-runner`がproviderを選び、provider adapterが各CLI・SDK・MCP差分を吸収する
- モデル出力は原則として厳格JSONにし、JSON Schemaで検証してから専用CLIへ渡す
- DB更新は既存の`db-apply-*`、`transition()`、トランザクションを通す
- 外部副作用は安定した冪等キーを持つoutboxまたは専用executorからだけ行う
- 自動フォールバックは副作用開始前、または外部状態を再取得して完了済み操作を照合できる場合に許可する
- 副作用開始後の中断は別providerで最初からやり直さず、同じrunをcheckpointまたは再照合から再開する
- provider固有のプロンプト、ツール名、CLI引数はadapter内に閉じ込める
- 最小公倍数の能力に合わせず、必要capabilityを満たすproviderだけを候補にする

## 全体構成

~~~text
Windowsタスク / katazuku CLI / 手動実行
                  |
                  v
          workflow definition
  目的・入力・capability・risk・schema・完了条件
                  |
                  v
        katazuku-agent-runner
  preflight / provider選択 / run台帳 / failure分類
          /             |              \
         v              v               v
  Codex adapter    Claude adapter    local OSS adapter
  codex exec       claude -p         Ollama / LM Studio等
         \              |               /
                  v
        strict JSON candidate
                  |
                  v
        schema validator / policy gate
                  |
                  v
  deterministic executor / db-apply-* / outbox
                  |
                  v
       katazuku.db + activity log + snapshot
~~~

モデルが直接DBのSQLを書いたり、送信済みか不明な状態で別providerが同じ処理を繰り返したりしない。

## workflow契約

人が編集する定義はYAML、モデルとの機械入出力はJSON、検証はJSON Schemaを使う。
将来の例は次の形とする。

~~~yaml
id: daily-sync
version: 1
prompt: workflows/daily-sync/prompt.md
inputSchema: schemas/daily-sync-input.schema.json
outputSchema: schemas/daily-sync-result.schema.json
capabilities:
  - gmail.read
  - calendar.read
  - workspace.read
risk: db-write
sideEffects:
  mode: deterministic-apply
  applyCommand: db-apply-mail
fallback:
  beforeSideEffects: true
  afterSideEffects: false
completion:
  - output-schema-valid
  - apply-committed
  - snapshot-pushed
  - activity-logged
~~~

`capabilities`は論理名であり、`mcp__claude_ai_Gmail__*`などprovider固有のツール名を
workflowへ書かない。adapterのcapability mapが、現在の実行環境で使えるツールへ変換する。

最低限のrisk分類は次のとおり。

| risk | 例 | 自動フォールバック |
|---|---|---|
| read-only | DBへの質問、予定候補の抽出 | 出力確定前なら可 |
| db-write | メール・面接・調査結果のDB反映 | apply開始前だけ可 |
| external-draft | メール下書き、候補イベント作成 | outbox投入前だけ可 |
| external-commit | ES送信、面接予約、辞退 | 自動切替不可。承認とcheckpointから再開 |

## 共通run契約

runnerへの要求はproviderに依存させない。

~~~json
{
  "schemaVersion": 1,
  "runId": "daily-sync:2026-07-19",
  "workflowId": "daily-sync",
  "workflowVersion": 1,
  "inputRef": "logs/agent-runs/.../input.local.json",
  "inputSha256": "...",
  "requestedCapabilities": ["gmail.read", "calendar.read", "workspace.read"],
  "resumeFrom": null
}
~~~

runnerの結果は、モデルが生成した本文と実行制御情報を分ける。

~~~json
{
  "runId": "daily-sync:2026-07-19",
  "attemptId": "...",
  "provider": "codex",
  "status": "succeeded",
  "phase": "planned",
  "sideEffectState": "none",
  "safeToFallback": false,
  "resultRef": "logs/agent-runs/.../result.local.json",
  "resultSha256": "...",
  "failure": null
}
~~~

`sideEffectState`と`safeToFallback`はモデルの自己申告を信用せず、runnerとexecutorが記録する。
プロンプト本文、メール本文、面接記録、個人情報をrun台帳へ複製せず、gitignoreされた参照先と
SHA-256だけを持たせる。

## provider adapter

adapterの共通interfaceは次を扱う。

1. CLIまたはendpointの存在確認
2. 認証・利用可能性のpreflight
3. 論理capabilityをprovider固有ツールへ対応付け
4. promptを標準入力で渡す
5. stdout、stderr、exit code、構造化イベントの正規化
6. provider固有エラーを共通failure codeへ分類
7. 機密値を除去した診断情報だけを返す

初期adapterは次の3系統とする。

| provider ID | 実行例 | 用途 |
|---|---|---|
| `codex` | `codex exec -C <repo> --sandbox workspace-write --json -` | 非対話の定常実行、MCP接続、コード・ファイル操作 |
| `claude` | `claude -p` | 現行workflowとの互換、既存Claude MCP接続 |
| `codex-oss` | `codex exec --oss --local-provider ollama`等 | ローカルOSSモデルで満たせる限定workflow |

上記コマンドはadapterの現在の実装例であり、workflowの公開契約ではない。CLIオプション変更は
adapterだけで吸収する。`danger-full-access`や承認を全面無効化するオプションを既定値にしない。

providerの優先順は個人設定または環境変数で上書きできる。既定はClaude優先
(`claude,codex,codex-oss`)とする。本人の基本運用はClaude Codeであり、CodexとローカルOSSは
利用枠切れ・障害時の代替、およびOSS利用者向けの選択肢として位置付ける。

~~~text
KATAZUKU_AGENT_ORDER=claude,codex,codex-oss
~~~

ただし順番だけで決めず、必要capability、risk、preflight、利用者が許可したproviderを満たす
候補の中から選ぶ。ローカルモデルにGmailやCalendarの認可済み接続がなければ、そのworkflowの
候補にはしない。

## failure分類とフォールバック

共通failure codeは少なくとも次を持つ。

| code | 意味 | 自動フォールバック |
|---|---|---|
| `command_missing` | CLIがない | 可 |
| `auth_unavailable` | 未ログイン、認証期限切れ | 副作用前なら可 |
| `quota_exhausted` | 利用枠切れ | 副作用前なら可 |
| `rate_limited` | 一時的な流量制限 | retry上限後、副作用前なら可 |
| `connection_failed` | 起動前または接続前の障害 | 副作用前なら可 |
| `capability_missing` | 必要MCP・toolがない | 可 |
| `invalid_output` | JSON/schema不一致 | retry上限後、副作用前なら可 |
| `timeout` | 完了を確認できない | 副作用状態が`none`と証明できる場合だけ可 |
| `partial_side_effect` | 外部操作が一部進んだ | 不可。checkpointから再開 |
| `user_action_required` | MFA、CAPTCHA、本人承認 | 不可。本人へ引き継ぐ |
| `runtime_error` | 分類不能な実行失敗 | 原則不可 |

選択状態は次のように進める。

~~~text
queued
  -> preflight_failed ---------> 次provider
  -> running_read_only
       -> failed_before_output -> 次provider
       -> output_validated
            -> applying
                 -> committed -> completed
                 -> interrupted/unknown -> needs_resume
~~~

`applying`へ入った後はproviderを変えて先頭から機械的に実行しない。`sideEffectMode=reconcile`では
第2providerへ、Gmail・Calendar・Drive・DB等の現在状態を再取得し、宛先・件名・予定時刻・外部ID・
sourceRef・runIdを照合して、完了済み操作を飛ばす指示を付与する。再照合手段のない`direct`は従来どおり
`needs_resume`で停止する。

### 利用枠状態の永続化と開発継続(2026-07-24)

Claude CLIが実際に返す `You've hit your weekly limit · resets Jul 26, 9pm (Asia/Tokyo)` 形式を
`quota_exhausted`として検知する。`resets`の日時はタイムゾーン込みでUTCへ変換し、
gitignore済みの`logs/agent-runs/provider-health.local.json`へ保存する。復活日時まではClaudeを
preflight前に除外し、復活後の次のrunでClaudeを再び先に試す。成功した時点で制限状態を消す。
日時を解釈できないCLI版では6時間のcooldown後に再試行する。

CLI起動自体がWindowsの制限トークン等で同期的に`spawn EPERM`を投げる場合も、runner外へ例外を漏らさず
`ProcessResult`へ正規化する。preflight段階の起動失敗として次providerを試す。

コード・文書開発には`sideEffectMode=workspace`を使う。workspace変更は同じ作業ツリーから観測・継続できるため、
Claudeが途中終了してもCodexへ切り替えられる。第2providerには作業ツリーと差分を先に確認し、既存変更を
保持して未完了部分だけを続ける指示を自動付与する。Gmail・Calendar等を再取得できる運用は`reconcile`、
再照合できない外部操作は`direct`として分離する。標準の開発入口は`scripts/run-agent-task.ps1`とする。

## 副作用の分離

新規workflowは原則として次の2段階にする。

1. agentが読取・抽出・判断を行い、厳格JSONを返す
2. 専用executorがschema、安全規則、承認、冪等キーを検証して反映する

既存の専用入口を優先して使う。

- メール: `db-apply-mail`
- カレンダー: `db-apply-calendar`とcalendar outbox
- 面接: `db-apply-interview`
- 提出結果: `db-apply-submission`
- 企業研究: `db-apply-research`
- 応募: application run / application eventの状態機械

DB commit後は既存規則どおり`db-snapshot.ts`と活動ログを実行する。snapshot push失敗は
DB commitを巻き戻さず、push再試行対象としてrunに残す。

ブラウザ操作など、agentが外部画面へ直接作用する必要があるworkflowでは、各確定操作の直前に
checkpointを記録し、操作後に外部の結果を読んでcommitする。送信ボタンを押したか不明な場合は
`unknown`として停止し、完了メール、画面、DB eventを照合するまで再送しない。

## run台帳とcheckpoint

共通runnerの実装時に、個別の`application_run`、`meeting_run`を置き換えず、横断的な実行台帳を
追加する。想定する最小構造は次のとおり。

- `agent_run`: workflow、安定runId、入力hash、全体status、phase、side effect状態
- `agent_attempt`: provider、開始・終了、exit code、failure code、result参照
- `agent_checkpoint`: runId、checkpoint名、対象の冪等キー、確定時刻、最小メタデータ

個別domainの正本状態は従来どおり各テーブルに置く。共通台帳は「どのproviderでどこまで
実行したか」を示し、業務事実を重複保存しない。

安定runIdの例:

- 日次同期: `daily-sync:<JST日付>`
- カレンダー同期: `calendar-sync:<同期窓>:<入力hash>`
- 面接: `interview:<appointment_id>`
- 応募: 既存の`sourceRef`
- 企業研究: `research:<company_id>:<調査版>`

## MCPと認可

ClaudeとCodexではMCPサーバー名やtool名が異なり得るため、workflowから直接参照しない。
provider設定は次を分離する。

- providerのCLI・model・profile
- MCP serverの接続設定
- 論理capabilityからtoolへのallowlist
- workspace、network、browser、外部書込の権限
- 認証状態のpreflight

Gmail、Calendar、ブラウザ、音声処理など、必要な接続を持たないproviderは失敗後に試すのではなく
選択候補から外す。API key、OAuth token、Cookie、合言葉をprompt、CLI引数、run台帳、活動ログへ
書かない。

## 現行スクリプトからの移行

2026-07-19時点では`apply-company.ps1`と`research-company.ps1`に部分的なagent選択があるが、
共通runnerではなく、失敗分類、capability検査、副作用後の再開制御がない。ほかの定常処理は
Claude CLIへ直接接続している。

移行は次の順で行う。

### Phase A: 共通runner

- provider registry、Codex/Claude/local OSS adapterを実装
- preflight、共通failure code、構造化ログ、dry-runを実装
- fake providerで選択とフォールバックを試験
- 既存のagent直接呼び出しを禁止するlintまたは回帰検査を追加

### Phase B: 読取・DB入力系

- `daily-sync`、`calendar-sync`、`mail-watch`、`asa`を共通runnerへ移す
- 抽出結果を厳格JSONにし、既存`db-apply-*`で反映
- `research-company`を共通runnerへ統合

### Phase C: 面接と会議

- `interview-digest`を文字起こし、構造化、DB適用に分割
- `meeting_run`を共通runのcheckpointと関連付ける
- 音声処理capabilityがないproviderでは構造化工程だけを引き継げるようにする

### Phase D: 応募とブラウザ

- `application_run`の承認点をrunnerのcheckpointと関連付ける
- サイト別adapterに外部結果確認と冪等化を追加
- 外部送信後のprovider自動切替を禁止する回帰試験を追加

## テストと受入条件

実装時には`sync/scripts/check-agent-runtime.ts`相当を追加し、少なくとも次を確認する。

- 第1providerの`quota_exhausted`から第2providerへ副作用なしで切り替わる
- CLI不在、認証切れ、capability不足をpreflightで除外する
- `invalid_output`をapplyせず、schema errorを機密値なしで記録する
- `applying`以降のtimeout、分類不能エラーでは自動切替しない
- 同じrunIdと冪等キーの再実行でDB、予定、下書き、応募runが重複しない
- providerを変えても同じfixtureから同じschemaの結果を返せる
- provider固有tool名がworkflow定義へ混入していない
- prompt、stdout、stderr、活動ログへ秘密情報が出ない
- 本人承認、認証、Web適性検査、辞退の安全境界がprovider変更で弱まらない

既存のDB、sheet、application、mobilityチェックと`npm run build`もすべて通す。

## OSSで公開する境界

公開候補:

- workflow schemaと匿名のworkflow例
- provider adapter interfaceとCodex/Claude/local OSS adapter
- failure分類、選択規則、checkpoint状態機械
- fake provider、匿名fixture、provider互換性テスト
- capability mapの雛形

非公開:

- OAuth token、API key、Cookie、個人用MCP設定
- 実際のメール、ES、面接記録、prompt入出力
- provider利用枠、個人アカウント情報、実行ログ
- 企業サイトの個人セッションと認証情報

特定providerの利用を必須にしないことはOSSの移植性を高めるが、安全境界までproviderごとに
作り直さないことが重要である。OSSの中心価値はモデルの選択肢の多さではなく、どのモデルを
使っても同じ承認、検証、冪等化、監査が適用される共通実行契約に置く。

## 現在の到達点

Phase Aとして次を実装済みである。

- `sync/src/agent-runtime.ts`: provider選択、preflight、failure分類、schema検証、副作用境界
- `sync/scripts/agent-runner.ts`: 非対話CLIとgitignoreされたrun artifact
- `scripts/invoke-agent.ps1`: Windowsジョブと既存PowerShellから使う共通入口
- Codex、Claude、Codex経由のOllama/LM Studio adapter
- `check-agent-runtime.ts`: fake providerによる利用枠切れ、capability不足、schema不一致、
  副作用後の切替禁止を含む回帰試験
- `apply-company.ps1`と`research-company.ps1`の共通runner移行

providerのCLIと認証状態は`npm --prefix sync run agent:doctor`で確認する。Codex adapterは
`codex login status`、Claude adapterはCLI起動をpreflightに使う。ローカルOSSはCLIだけを
preflightし、OllamaまたはLM Studioのmodel endpointはworkflow実行時に確認する。

### Phase B 着手: daily-syncの副作用分離(2026-07-20)

daily-syncのDB反映経路を、モデル直接applyから「抽出(read-only)→決定論的executor」へ分割した。

### Phase B.3: workflow工程契約の実装(2026-08-24)

step単位のowner、capability、副作用、承認、冪等性、遷移をJSON契約として実装した。横断実行台帳は
業務正本と混ぜず`logs/workflow-runtime.local.db`へ置き、対象となる正本DB identityとroleをrun開始時に固定する。
`daily-sync-v2`は最初の適用先として、Agentを`extract`工程だけに限定した。詳細はspec17を参照する。

- `scripts/daily-sync-extract-prompt.md`: 抽出フェーズのプロンプト。agentはGmailを読むだけで、
  DB・シート・カレンダー・Gmailラベルを一切変更しない。`daily-sync-result.schema.json`準拠の
  厳格JSONを1つ返す。必要capabilityは`gmail.read`のみ。
- `sync/schemas/daily-sync-result.schema.json`: selections/mailItems/submissions/priorityMailsの
  厳格schema(未知項目を拒否)。抽出結果はagent層(runAgentの`--output-schema`)と
  executor層の両方で検証する(二重ゲート)。
- `sync/scripts/daily-sync-apply.ts`: 決定論的executor。schema検証→既存の`applyDiff`/`applyMail`/
  `applySubmission`を1つのDB接続で束ねて反映する。暴走ブレーキ(16社超)と提出物1件の失敗隔離を持つ。
  モデルにSQL・DB書込を委ねない。`applyMail`/`applySubmission`は共有DBを受け取れるよう後方互換で拡張した。
- `scripts/daily-sync-v2.ps1`: オーケストレータ。invoke-agentで抽出(providerはcapabilityで自動選択。
  Gmail接続のないCodex/OSSは候補から外れClaudeが選ばれる)→daily-sync-apply→db-snapshot→活動ログ。
- `check-daily-sync-apply.ts`: schema拒否・冪等・暴走ブレーキ・提出失敗隔離の回帰試験。

これによりdaily-syncの**DB書込経路はprovider非依存**になった。Gmailの既読化・ゴミ箱整理・シートミラーは
external副作用のため v2 には含めず、従来 daily-sync.ps1 に残す(Phase B.2 で別executorへ分離する)。
calendar-sync/mail-watch/asa/interview-digestは同じ2段パターンで順次移行する。

### 実走で判明したCodex CLIの版差修正(2026-07-20)

企業研究をCodexで実走して2件のバグを修正した。

- 現行の`codex exec`は`--search`引数を持たず`unexpected argument '--search'`で即失敗する。web検索は
  config override(既定`-c tools.web_search=true`)で有効化する。CLIの版差を吸収するため
  `KATAZUKU_CODEX_WEB_SEARCH`(OSSは`KATAZUKU_CODEX_OSS_WEB_SEARCH`)で丸ごと差し替え可能にした。
- CLIの引数解釈失敗(clapのusageエラー)を`runtime_error`ではなく起動前の`command_missing`相当へ
  分類する。invocationが現行CLIと形が合わないだけでモデル・ツールは動いておらず副作用は起きえないため、
  `needs_resume`で停止せず安全に次providerへフォールバックする。`error:.*found`のような実行時の
  "not found"へ誤爆しないよう、clap特有のマーカーだけに絞った。

### Windows sandboxの注意(2026-07-19)

Windowsのcodex sandboxは、`codex.exe`と同じ場所にある`codex-command-runner.exe`を
制限ユーザー(CodexSandboxOffline/Online)で起動して命令を実行する。単体インストーラー版の
`codex.exe`(`AppData\Local\Programs\OpenAI\Codex\bin`)はこのhelperを同梱しないため、
sandbox内の全shell実行が`CreateProcessWithLogonW failed: 2`で失敗する。

対策として`resolveProviderCommands`は、helperが同じ場所にあるcodex実体
(デスクトップアプリ同梱の`AppData\Local\OpenAI\Codex\bin\<hash>\codex.exe`など)を優先して
選ぶ。`agent:doctor`は`codex sandbox -- cmd /d /c echo <marker>`でsandboxの実働を確認し、
失敗時は`sandbox.detail`へ原因を出す。手動で固定したい場合は`KATAZUKU_CODEX_COMMAND`へ
helper同梱のcodex.exeのフルパスを設定する。`--dangerously-bypass-approvals-and-sandbox`での
回避は行わない。

Codexの既定capabilityはworkspace read/write、shell、web searchだけである。Gmail、Calendar、Drive、Sheetsは
対応するMCPを認証したうえで、repoまたは親階層の`.codex/config.toml`に
`[mcp_servers.google-workspace]`があれば論理capabilityを自動検出する。明示的に制御する場合は
`KATAZUKU_CODEX_CAPABILITIES`で上書きする。interview-digestはローカルVoiceboxのURLを実行時config overrideで
Codexへ渡し、`voice.transcribe`を利用可能にする。既存Chromeは引き続き個別設定が必要。

daily-sync-v2はDB書込経路を分割済みで、Google Workspace MCP設定済み端末ではCodexへ切替可能。
旧daily-sync、calendar-sync、mail-watch、asa、reconcile-calendar、open-meeting-urls、katazuku、interview-digestも
provider直呼びを除去し、共通runnerへ移行した。未分離の外部副作用は`reconcile`で現状態を再取得して継続するが、
長期的にはPhase B/Cの厳格JSON生成と決定論的executorへの分割を続ける。

Codex CLIの非対話実行やMCP設定の詳細は実装時点の公式リファレンスを再確認し、adapterへ閉じ込める。
