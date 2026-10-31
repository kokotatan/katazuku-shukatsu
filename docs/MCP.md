# katazuku MCP

katazukuの正本SQLiteを、Muse・Codex・Claude CodeなどのMCPクライアントから使うための入口です。
標準入力/出力とStreamable HTTP互換のJSON-RPCを提供し、同じtool契約を共有します。

## 安全モデル

既定scopeは`read`だけです。使う能力だけをカンマ区切りで明示します。

| scope | できること | できないこと |
|---|---|---|
| `read` | 予定、選考、空き、提出物、要対応メール要約 | 書込み、メール本文、外部操作 |
| `sensitive` | プロフィール、人脈、面談記録、企業研究を含む個人スナップショット | 画像本体、資格情報 |
| `write` | 取得済みメール要約、Calendarイベント、提出結果の正本への冪等反映 | メール送信、Calendar作成、応募提出、受験 |
| `actions` | 第三者確定操作を承認台帳へ提案し、内容hashを固定 | 承認、送信、予約、購入、取消 |

`read,write,sensitive,actions`がkatazuku内の全scopeです。ただし「フルアクセス」は資格情報・任意SQL・任意シェルを
渡す意味ではありません。第三者への確定操作は、本人が固定済み内容を確認し、専用Executorが同じhashだけを実行します。
MCP tool callそのものを本人承認とは扱いません。

## stdioで起動

先に`npm run init`で正本を作ります。既存DBを使う場合は絶対パスを指定します。

```sh
KATAZUKU_MCP_DB=/absolute/path/to/katazuku.db \
KATAZUKU_MCP_SCOPES=read,write,sensitive,actions \
npm run mcp
```

MCPクライアントには、commandを`npm`、argsを`run mcp`、working directoryをこのリポジトリに設定します。
個人データを扱うため、環境変数を共有設定や公開ファイルへ書かないでください。

## loopback HTTP

```sh
KATAZUKU_MCP_DB=/absolute/path/to/katazuku.db \
KATAZUKU_MCP_SCOPES=read,write,sensitive,actions \
KATAZUKU_MCP_TOKEN='32文字以上のランダム値' \
npm run mcp -- --http
```

既定URLは`http://127.0.0.1:8798/mcp`です。Bearer token、Host、Origin、MCP protocol version、
body上限を検査し、URL queryへのtokenは受け付けません。プロセスは常にloopbackへbindします。

別端末やクラウドのエージェントから使う場合、このHTTPサーバーを直接インターネットへ公開しないでください。
TLS、OAuth 2.1、短命token、利用者単位のscope、レート制限、監査を持つgatewayを前段に置き、
gatewayから端末への経路も認証してください。DBやGoogleのrefresh tokenをgatewayへ複製しない構成を推奨します。

## 公開tool

- `katazuku_today` / `katazuku_next` / `katazuku_conflicts` / `katazuku_status`
- `katazuku_availability`: 同期鮮度・正本role・移動を検査し、`unknown`を空きに丸めない
- `katazuku_submissions` / `katazuku_actionable_mail`
- `katazuku_snapshot` (`sensitive`)
- `katazuku_record_mail` / `katazuku_record_calendar` / `katazuku_record_submission` (`write`)
- `katazuku_prepare_action` / `katazuku_action_status` (`actions`)

tool一覧は起動時scopeに応じて削られます。許可されていないtoolは名前を知っていても呼べません。

## 検証

```sh
npm run test:mcp
npm run test:workflow-control
```

テストはscope分離、正本読取、冪等入力、承認actionの改変拒否、任意command拒否、HTTP認証とloopback境界を確認します。

