# iCloud Mail adapter

AppleのiCloud Mailを、katazukuの承認済みメールExecutorへ接続する任意adapterです。MCPやAgentへ
SMTP/IMAP資格情報を渡さず、別プロセスがcredential brokerから実行直前に取得します。

固定接続先はApple公式設定に従います。

- IMAP: `imap.mail.me.com:993`、TLS必須
- SMTP: `smtp.mail.me.com:587`、STARTTLS・認証必須
- Apple Accountの通常パスワードではなく、対応アプリの認可またはapp-specific passwordを使う

参考: [AppleのiCloud Mail server settings](https://support.apple.com/102525)、
[app-specific password](https://support.apple.com/102654)

## ローカル設定

設定はリポジトリ外またはgitignore対象の`*.local.json`へ置きます。

```json
{
  "version": 1,
  "senderEmail": "contact@example.com",
  "credentialBroker": {
    "executable": "C:\\absolute\\path\\to\\credential-broker.exe",
    "args": ["read", "icloud-mail-contact"]
  }
}
```

brokerは標準出力へ`{"username":"...","password":"..."}`だけを返し、秘密値をログへ出してはいけません。
adapterの親プロセスは秘密値を受け取らず、worker内だけでIMAP/SMTPへ渡します。設定ファイルの変更APIは
公開しないため、Museからbroker実行ファイルやsecret IDを差し替えることはできません。

`KATAZUKU_ICLOUD_MAIL_CONFIG`に設定ファイルの絶対パスを指定し、
`ProcessEmailDeliveryAdapter`からNode.jsと`worker.mjs`を固定引数で起動します。送信元、provider、action hash、
元メール、正本DB、本人承認は親Executorが検査します。送信後はiCloudのSent mailboxで
`X-Katazuku-Action-Hash`を照合できた場合だけ完了し、結果不明では再送しません。

資格情報の初回作成、Apple Accountの二要素認証、brokerへの保存は本人操作です。

## 受信

`inbox.mjs`は標準入力の`{"query":{"from":"sender@example.com","limit":20}}`を受け、固定のINBOXから
絞り込んだメールだけを構造化します。添付本体とHTMLは返さず、1MiB超のメールは本文を取得しません。
認証コード・ワンタイムコードと判定したメールも本文を空にするため、Agentのプロンプトへ秘密値を渡しません。
結果はローカルで`katazuku_record_mail`またはDB writerへ渡し、クラウドgatewayには保存しません。
