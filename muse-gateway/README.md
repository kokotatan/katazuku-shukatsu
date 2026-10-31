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

実在する設定を作った後、deployより先に次を実行します。HTTPS origin、placeholder、KV/DO、秘密の平文混入、
ログ無効化を検査し、秘密値を読まずに審査用endpointとsource hashをJSON出力します。

```sh
npm run muse:production-preflight -- --config=muse-gateway/wrangler.jsonc > muse-production-evidence.json
```

この証跡はlive deploymentやMeta承認を意味しません。外部から`/health`、OAuth discovery、token失効、MCP、
bridge切断時のfail-closedを確認してから、production確認済みとして扱います。

MetaはConnector Platformで提出項目、tool権限分類、3段階審査、承認後のSettings > Connectorsでの発見方法を公開しています。
このgatewayは未提出・未承認です。実装済み、提出済み、承認済み、利用者接続済みを区別し、
[`docs/MUSE-CONNECTOR-SUBMISSION.md`](../docs/MUSE-CONNECTOR-SUBMISSION.md)の不足項目を解消してから提出してください。
登録値やredirect URIは提出画面と実機のOAuth discoveryを照合し、推測で設定しません。
security incidentでは[`docs/MUSE-INCIDENT-RESPONSE.md`](../docs/MUSE-INCIDENT-RESPONSE.md)に従い、
bridge停止、grant失効、鍵rotation、最小証跡保全、48時間以内のMeta通知を行います。

## 検証

```sh
npm run test:mcp
npm run test:muse-gateway
```

gatewayテストはOAuth discovery、PKCE、CSRF、scope分離、端末不在時のfail-closed、中継、認可codeの
再利用拒否をローカルworkerdで確認します。さらに全4 scopeのOAuth tokenを発行し、実`muse-bridge.ts`、
合成SQLite、schema-native MCPを接続して、`read`、`sensitive`、`write`、`actions`のtool callが端末まで
往復するE2E試験を行います。HTTPはこのloopback試験で明示フラグを付けた場合だけ許可され、本番bridgeはHTTPSを必須にします。
