# Gemini Sparkへの非同期引き渡し

Sparkを調査・抽出・文書草案の作業先として使う任意の経路です。Gemini CLIとは別サービスです。
正本DBへの反映・第三者への送信・予約の確定はこの経路では行いません。

## 利用方法

リポジトリ直下で入力ファイルを用意します。入力の相対パスはリポジトリ直下が基準です。

```powershell
npm run spark -- prepare document logs/input.txt
npm run spark -- receive <runId> logs/response.json
npm run spark:queue -- enqueue example-task document logs/input.txt
npm run spark:queue -- list
npm run spark:worker
```

用途はresearch（企業研究）、daily-sync（提供メールの抽出）、meeting-prep（面談準備案）、document（文書）、reply-draft（返信案）。
prepareのprompt.txtをSparkへ渡し、完成したJSONだけをreceiveします。キューを使う場合はworkerが送信・結果回収を行います。
依頼キーは一意にします。同じキー・内容は同じ依頼を返し、内容の差替えは拒否します。
依頼ID・hash・24時間の期限・Schemaを確認し、結果はneeds_reviewとして受領します。hashは本人承認や送信元の認証署名ではありません。
研究の出典URLと本文の事実は別途確認してください。形式検証だけで正しい情報とみなさないでください。

## Windows常時運転PC

ChromeでSparkとClaude in Chromeを使える状態にし、Claude CLIを用意します。
`logs/spark-worker.local.json`に`enabled: true`と`account`（Sparkへログインしている本人のアカウント）を設定します。
設定ファイル・入力資料・ログは公開しません。認証情報を入力資料へ入れないでください。

```powershell
powershell -File scripts/register-spark-worker.ps1
```

5分間隔のWindowsタスクです。設定なし・空キューならモデルは呼びません。
workerはブラウザの受け渡しだけをClaudeへ依頼し、重い作業はSparkへ渡します。使用量の削減率は未計測です。
Chrome拡張やUI変更・認証切れ・利用上限によって停止するため、既存providerの無条件の置き換えにはしません。

状態はqueued → dispatching → awaiting → polling → needs_review。
送信中のクラッシュ・成否不明はblockedとし、再送しません。取得中のクラッシュは同じタスクURLの確認へ戻ります。
確認間隔10分、最大12回、作業リース10分。本人がSparkの履歴と依頼IDを照合した後だけ、
`npm run spark:queue -- reconcile <runId> <SparkタスクURL>`で結果回収へ戻せます。
ログイン/MFA/同意の操作は本人へ引き継ぎます。Webテスト・コーディングテストの受験には使いません。

## MCPとスマホ向けの接続準備

`npm run spark:mcp`でstdio、`npm run spark:mcp -- --http`でループバックHTTP MCPを起動します。
HTTPには環境変数`KATAZUKU_SPARK_TOKEN`（32文字以上）が必要です。ポートは8797（`KATAZUKU_SPARK_PORT`で変更可）。
Bearerヘッダー以外の認証は受け付けず、Originのある要求・外部Host・URLの秘密値を拒否します。
管理用の台帳パス指定は`KATAZUKU_SPARK_QUEUE`。通常はlogs/spark-queue.local.dbです。

固定ツールはspark_enqueue、spark_status、spark_list、spark_claim、spark_report。
任意のシェル、SQL、送信、予約、承認を実行するツールはありません。
対応クライアントがclaimした依頼を処理しreportすることで、ブラウザworkerを介さない受け渡しもできます。
スマホのSparkから利用するには、別途TLS/OAuth gatewayとSpark側の接続認証が必要です。
**この版に公開gatewayは含まれず、スマホから接続済みではありません。** ループバックサーバーをそのまま外部公開しないでください。

## 検証

`npm run test:agent-runtime`に、5用途のSchema、依頼取り違え・改変・期限、二重claim・二重結果、リース回復、
不正URL、HTTP認証・Origin/Host・固定ツールの検査を含めています。
実行台帳は正本DBとは分離されています。コードの純粋なコアはprivate版と同じテストを維持します。

公式資料: [Sparkの利用方法](https://support.google.com/gemini/answer/17094507?hl=en)、
[カスタムアプリ接続](https://support.google.com/gemini/answer/17209137)、
[MCP transport](https://modelcontextprotocol.io/specification/2025-06-18/basic/transports)。
提供条件は変わるため、接続先アカウントの画面でも確認してください。
