# Private adapters

katazukuは、公開できる運用契約と、本人の端末・アカウントに結び付く認証実装を分けます。
機能を減らすための分離ではありません。公開MCPを安定した最小権限のcontrol planeにし、private adapterが
ローカルで資格情報を使って実サービスへ接続する構成です。

## 公開層

- 正本SQLite、予定、選考、提出、面談準備、企業・人物調査の型付きMCP
- OAuth scope別のMuse gatewayと端末へのprivate relay
- action hash、本人承認、正本・予定・元メッセージの再照合
- 日程フォームと採用ポータル連絡の汎用workflow契約。企業別hostは設定値として分離
- provider非依存のメールExecutorと、shellを使わない別プロセスadapter契約
- iCloud Mail用の固定IMAP/SMTP adapter
- Muse Secure VMの内蔵email connectorから、資格情報なしで送信証跡だけを受けるMCP契約
- 合成fixture、秘密値を使わない回帰テスト、依存脆弱性検査

## Private層

- 利用者本人の送信元アドレス
- credential brokerの実行ファイルとsecret ID
- Apple Accountの認可またはapp-specific password
- Google OAuth cache、MiniPC/ノートPCの役割、SSH allowlist
- 実企業のportal URL、専用Chrome profile、端末固有のDPAPI/Keychain/Secret Service record

Private設定は`*.local.json`、OS keychain、credential brokerへ置き、git、DB、snapshot、MCP、Skill、
Cloudflare gatewayへ出しません。MCPからprivate設定の変更、資格情報読出し、任意command実行は提供しません。

## メールprovider

`ThirdPartyEmailAction`は新規actionで`actionType: email.send`と次を固定します。

```json
{
  "provider": "icloud-mail",
  "senderEmail": "contact@example.com"
}
```

この値もaction hashへ入り、承認後のprovider・差出人差し替えを防ぎます。Google Workspaceは
`provider: google-workspace`を使い、旧`gmail.send`も互換入力として残します。どのproviderでも
送信済み外部記録を照合できない場合は`unknown`で停止し、自動再送しません。

Muse経由ではtargetへ`"executor": "muse-email-connector"`を追加します。このactionはローカルSMTP/Gmail Executorが
拒否します。Museの毎回承認後、送信message IDとSent再照合message IDが一致した証跡だけを固定済みactionへ結び付けます。
Muse Secure VM内の資格情報、OAuth token、Cookieはこのリポジトリへ来ません。

iCloud実装は[adapter README](../adapters/icloud-mail/README.md)を参照してください。Apple公式の固定host、
TLS、app-specific passwordの要件を実装へ固定し、受信時はHTML・添付本体・認証コードをAgentへ渡しません。

公開機能とprivate境界の確認結果は[private版との追随台帳](PRIVATE-PARITY.md)を参照してください。
