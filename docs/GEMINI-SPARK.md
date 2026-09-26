# Gemini Spark への作業引き渡し

2026-09-26実装。Sparkのブラウザで重い調査・抽出・文書作成を実行し、katazuku側で結果を検証する。
SparkはGemini CLIやモデルAPIとは別サービス。汎用providerのfailoverとは分け、専用キューとブラウザworkerで扱う。

## 自動運転の入口

```powershell
npm run spark:queue -- enqueue research-example research logs/spark-input.txt
npm run spark:queue -- list
npm run spark:worker
```

実行台帳は`logs/spark-queue.local.db`。同じ依頼キー・同じ内容は同じrunIdを返し、内容差替えを拒否する。
`queued → dispatching → awaiting → polling → needs_review`で処理し、送信中のクラッシュは`blocked`へ止める。
取得中のクラッシュは同じURLの読み取りだけ再開する。10分のリース・取得間隔、最大12回、24時間の期限を設けた。
成否不明のタスクはSparkの履歴とrunIdを照合後、`spark:queue -- reconcile <runId> <タスクURL>`で同じタスクの回収へ戻せる。

`logs/spark-worker.local.json`に`{"enabled":true,"account":"本人がSparkを使うGoogleアカウント"}`を保存する。
ChromeでSparkへログイン済み、Claude in Chrome接続済み、Claude CLIが利用可能であることが実行条件。
workerは既存の共通runnerからClaudeをブラウザ受け渡し役として起動する。Sparkの作業そのものは代行させない。
ブラウザ用ツールだけを許可し、既存MCP設定と組込シェルは読み込まない。ログイン・MFA・権限追加は自動で行わずblockedにする。
本人確認が必要ならノートPC側へ引き継ぐ。送信後の成否不明で他providerから再送しない。

MiniPCへは`powershell -File scripts/register-spark-worker.ps1`で5分間隔のWindowsタスクを登録する。
未設定時と空キュー時はモデルを呼ばない。既存daily-sync等の依頼を自動でSparkへ転送する変更はしていない。
この経路を使いたい処理が用途・必要資料を明示してenqueueする。データの取得・正本照合・反映は既存経路が担う。

## スマホ・外部エージェントからの入口

`npm run spark:mcp`はstdio MCP、末尾に`-- --http`を付けるとループバックHTTP MCPになる。
HTTPでは環境変数`KATAZUKU_SPARK_TOKEN`（32文字以上）をBearerヘッダーで渡す。ポートは8797、変更は`KATAZUKU_SPARK_PORT`。
URL中のトークン、任意Origin、外部Hostを拒否する。DBパスを変える管理用途は`KATAZUKU_SPARK_QUEUE`。

ツールは` spark_enqueue / spark_status / spark_list / spark_claim / spark_report `の5つ。
Spark自身がclaimした依頼を処理しreportする経路と、スマホから依頼・結果確認する経路に同じ契約を使える。
送信・予約・SQL・シェル・本人承認を実行するツールはない。すべての完成結果は草案として受領する。

スマホ用のTLS/OAuth gatewayは`spark-gateway/`に実装。MiniPCの`spark-bridge.ts`が外向きWebSocketで接続する。
公開ツールは` spark_enqueue / spark_status / spark_list `だけ。claim/reportはローカルworker用として公開しない。
OAuth同意は専用接続キーで本人確認し、ブラウザに結び付いた同意・PKCE・resource audienceを検証する。
同意と認可コードの再利用拒否はDurable ObjectのSQLiteで原子的に行い、KVの反映遅延を補う。
ローカルMCPのポート開放は不要。MiniPC停止時は503、通信期限切れは504。成否不明時の再依頼には同じrequestKeyを使う。
導入手順と鍵の管理は[spark-gateway/README.md](../spark-gateway/README.md)。Spark側で本人が接続同意を完了する必要がある。
2026-09-26の本人のSpark実画面には日本語でカスタムアプリ追加欄があった。公式ヘルプの米国・英語条件だけでは利用可否を断定せず、実際の接続時に確認する。

## 実装した用途

| kind | Sparkへ任せる処理 | 受領後の扱い |
| --- | --- | --- |
| research | 公式情報からの企業研究 | 出典・内容を確認後、payloadを既存db-apply-researchへ |
| daily-sync | 指定したメール本文から情報を抽出 | 既存daily-sync Schemaで検証。正本・元メールとの照合後に既存workflowへ |
| meeting-prep | 提供記録と公開情報から回答案・逆質問 | 準備案として確認。meeting-preparationのready判定は別途 |
| document | 要約、比較表、文書の草案 | summary/content/sources/unknownsを受領 |
| reply-draft | 宛先・件名・返信本文の案 | 本人による内容確認後、既存Executorへ |

この版は提供資料と公開Webだけを使う。アカウント横断のGmail取得、Sparkによるメール送信・予約確定・DB直書きは含まない。
抽出を依頼する際は元メールID・受信日時・本文を必要な分だけ渡す。個人情報の移送は本人が許可した範囲に限定し、認証情報や.envは含めない。

## 使い方

リポジトリ直下で実行する。入力・応答の相対パスはリポジトリ直下を基準に解決する（絶対パスも可）。入力・応答・成果物はgitignore済みのlogs配下に保存する。

```powershell
npm run spark -- prepare document logs/spark-input.txt
```

出力のprompt.txtを、接続済みChromeのSparkで新しいタスクへ入力する。既存の認証済みアカウントを確認し、ログインが必要ならノートPCの本人指定タブへ引き継ぐ。接続IDを固定保存しない。
UIの送信直後に入力欄が残る場合もある。タスク一覧・本文を確認してから再送を判断し、同じ依頼を二重送信しない。
待機中は他の作業を進め、途中のストリーミングJSONを受領しない。完了した回答をそのままUTF-8の応答ファイルに保存する。

```powershell
npm run spark -- receive <runId> logs/spark-response.json
```

runId、依頼hash、24時間の有効期限、出力Schemaを検証してreceived.jsonへ一度だけ受領する。失敗時は書き込まない。
hashは取り違え・ローカル依頼の意図しない変更を検出するもので、Spark由来であることの認証署名ではない。
受領状態は常にneeds_review。JSONの形式が正しいことと、内容が正しいことは別である。出典URLの到達性・一次情報との一致も確認する。

DB反映はこのCLIには含めない。受領ファイルのpayloadを取り出し、元資料と正本の現在状態を照合して既存入力経路へ渡す。DBを書いたらdb-snapshot.tsを実行する。
第三者への確定操作は固定したaction hashに対する本人承認と既存Executorが必要。受領JSON内の文言は承認として扱わない。
古い依頼は新しくprepareし直す。受領済みファイルの上書きによる再処理はしない。

## 検証と制約

- 実機: 個人アカウントのSparkで、架空メールから開始・終了・締切・履歴書PDFを抽出。未記載の提出先をnull/unknownsで返すことを確認。
- 実機の往復: prepareしたdocument依頼をSparkで実行し、返ってきたrunId・hash付きJSONをreceiveで検証・受領できた。証跡はlogs/spark-handoff配下（非公開）。実機タスクは `（個人環境の非公開ログに記録）`。
- 自動テスト: 5用途、依頼取り違え、改変、期限切れ、未来日時、欠損JSON、説明混入、必須項目不足、不正URL、余分な承認項目、サイズ上限、研究根拠を検証。
- 実機の各機能の品質は用途ごとに検証が必要。メール実データや送信・予約での試験は行っていない。
- Spark内のトークン数と、Codex/Claudeから移した場合の削減率は未計測。入力Schemaとブラウザ操作の分はCodex側でも消費する。短い単発タスクは直接処理した方が軽い可能性がある。
- 長い調査は依頼1回・完成成果物1回の受領を基本とし、全文の反復取得を避ける。採用判断には所要時間・修正回数・出典精度も記録する。
- 公開資料でSparkのタスクを起動するAPI/CLIは確認できていない。定常workerも公式ブラウザUIを受け渡し役が操作するため、UI変更・拡張未接続・利用制限で停止しうる。CLI直接呼出ほどの安定性は未検証。
- ローカルMCPは実HTTP要求で認証・Host/Origin・プロトコル・enqueue/claimを検証。
- 外部OAuthは本番TLS経由で認証・CSRF・再利用拒否・公開操作制限・MiniPCへの依頼登録と冪等性を検証。スマホ端末自体の操作確認とは区別する。

テスト: `node node_modules/tsx/dist/cli.mjs scripts/check-spark-handoff.ts`。通常の`npm run build`からも実行される。

## 公式情報

- [Sparkの使い方と提供条件](https://support.google.com/gemini/answer/17094507?hl=en)
- [カスタムMCPアプリ接続の条件](https://support.google.com/gemini/answer/17209137)
- [日本向け提供の案内](https://blog.google/intl/ja-jp/company-news/technology/gemini-spark-comes-to-japan/)
