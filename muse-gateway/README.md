# Muse向けHTTPS・OAuth MCP gateway

Museなどのremote MCP clientと、所有者の端末で動くkatazuku MCPをつなぎます。Cloudflareへ置くのは
OAuth認可と一時中継だけです。正本SQLite、Google資格情報、toolの引数・結果は永続化しません。

公開するscopeは次の4つです。

| OAuth scope | 端末側scope | 用途 |
|---|---|---|
| `katazuku:read` | `read` | 予定・選考・空き・提出物・メール要約 |
| `katazuku:write` | `write` | 取得済み事実の冪等な正本反映 |
| `katazuku:sensitive` | `sensitive` | プロフィール・人脈・面談記録・企業研究 |
| `katazuku:actions` | `actions` | 第三者操作の承認提案・状態確認 |

全scopeでも資格情報、任意SQL、任意シェル、メール送信、予約確定、応募提出、適性検査は公開しません。
`actions`は内容hashを固定して本人承認待ちにするだけです。

## セルフホスト

1. `npm --prefix muse-gateway ci`を実行します。
2. `wrangler.example.jsonc`を`wrangler.jsonc`へコピーし、Worker名、`PUBLIC_ORIGIN`、KVのIDを自分の値にします。
3. 十分に長いowner keyとbridge tokenを生成します。owner keyのSHA-256だけを`OWNER_KEY_SHA256`、token本体を
   `BRIDGE_TOKEN`として`wrangler secret put`で保存します。平文のowner keyはパスワードマネージャーへ保存します。
4. `npm --prefix muse-gateway run deploy`でデプロイします。リクエストログは無効のままにします。
5. 端末の`logs/muse-bridge.local.json`を次の形で作ります。

```json
{
  "origin": "https://muse.example.com",
  "token": "43文字以上のbridge token",
  "scopes": ["katazuku:read", "katazuku:write", "katazuku:sensitive", "katazuku:actions"]
}
```

必要なら`dbPath`と`workflowStorePath`も絶対パスで指定できます。`scopes`を省略した場合は端末側でも
`katazuku:read`だけに制限します。

6. `npm run muse:bridge`を常駐端末で起動します。
7. Museにcustom remote MCPの登録画面が提供されている場合だけ、`https://<host>/mcp`を登録し、owner keyで同意します。

Metaが公開しているMCP対応はモデル能力の説明までで、Muse製品の一般利用者向け登録画面・redirect URI・審査手順は
公開確認できていません。未公開の画面名やURLを推測せず、実機表示とOAuth discoveryを照合してください。

## 検証

```sh
npm run test:mcp
npm run test:muse-gateway
```

gatewayテストはOAuth discovery、PKCE、CSRF、scope分離、端末不在時のfail-closed、中継、認可codeの
再利用拒否をローカルworkerdで確認します。
