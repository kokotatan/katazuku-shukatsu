# Museとの接続

MetaはMuseを、接続済みアプリやWebを横断して背景実行でき、重要操作の承認と監査履歴を持つ
パーソナルエージェントとして説明しています。Muse Spark 1.1の公式発表では、モデルが新しいMCP serverと
custom skillへzero-shotで適応できるとも明記されています。

- [Muse公式](https://ai.meta.com/muse/)
- [Muse Spark 1.1公式発表](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/)
- [Museの安全設計](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)
- [Muse Connectorガイドライン](https://platform.muse.ai/docs)

## 2つの接続面

### 1. SkillをMuseへ配る

AgensiはMuseを対応agentとして掲げ、Agensi MCP経由でSKILL.mdを都度読み込む方式を案内しています。
この経路は「katazukuをどう使うか」という手順・判断基準・安全境界をMuseへ渡すものです。

- [AgensiのMuse marketplace](https://www.agensi.io/muse-marketplace)
- [Agensi MCPのOAuth仕様](https://www.agensi.io/docs/mcp-server)

Skillだけでは利用者のローカルSQLiteへ接続できません。Agensi自身も、skillはagentの働き方を変え、
plugin/MCP serverはAPI・DB・toolという能力を追加する別物だと区別しています。

### 2. katazuku MCPを接続する

このリポジトリの`npm run mcp`が、正本DBへつながる標準MCP serverです。`read,write,sensitive,actions`では、
予定・選考・提出物・個人スナップショットの参照に加え、取得済みメール/Calendar/提出結果、企業・人物調査、
面談議事録、面談準備を型付きwriterで正本へ戻せます。任意SQL、任意shell、資格情報、ローカルファイルpath、
無承認の第三者送信は「フルアクセス」に含めません。Muse側で任意のMCP serverを
登録できる環境では、[MCPガイド](MCP.md)のStreamable HTTP endpointを登録します。

remote接続に必要なOAuth 2.1 gatewayと端末へのprivate relayは`muse-gateway/`に実装しています。DB、Google資格情報、
tool payloadはCloudflareへ永続化せず、OAuth scopeと端末側allowlistの両方で制限します。導入手順は
[gateway README](../muse-gateway/README.md)を参照してください。
提出用のtool分類、データフロー、E2Eシナリオ、未完了項目は
[Muse Connector提出準備](MUSE-CONNECTOR-SUBMISSION.md)に固定しています。

MetaはMCP serverを含むConnectorの提出契約、審査手順、tool permission、Settings > Connectorsでの発見方法を
公開しています。sensitive writeは毎回HITL承認で、Always allowにはできません。ただしこのリポジトリのConnectorは
未提出・未承認であり、利用者アカウントへの実機接続も未完了です。gateway実装済み、提出済み、Meta承認済み、
アカウント接続済みを区別し、次を順に照合します。

1. transportがStreamable HTTPであること
2. OAuth 2.1または同等の利用者認証を要求できること
3. toolごとの承認表示とscopeが確認できること
4. `read`だけで接続し、tool一覧と架空DBで疎通すること
5. `sensitive`、`write`、`actions`を一つずつ追加すること
6. `katazuku_prepare_action`が実行せず`needs_user`で止まることを確認すること
7. iCloud返信は`katazuku_prepare_muse_email`のhash固定後だけMuse email connectorへ渡すこと
8. Museの毎回承認後、送信message IDとSent再照合message IDを`katazuku_record_muse_email_result`へ戻すこと

全scopeを許可する場合は`katazuku:read`、`katazuku:write`、`katazuku:sensitive`、`katazuku:actions`を選びます。
これはkatazukuの全機能scopeであり、OSやGoogleアカウントの無制限アクセスではありません。

## 推奨構成

```text
Muse
  ├─ Agensi MCP ── katazuku運用Skill（手順・判断・ガードレール）
  └─ 認証済みremote MCP gateway
          └─ 相互認証されたprivate経路
                 └─ 端末のkatazuku MCP(loopback) ── 正本SQLite
```

SQLite、Google資格情報、本人情報をクラウドgatewayへ置かず、端末側でtoolを実行します。remote gatewayは
tool payloadと結果を必要最小限だけ中継し、tokenをURL・ログ・Skill本文へ書きません。

## Museのemail connectorでメールを使う

この経路は、利用者の実際のMuseアカウントに対象メールボックスへ接続できる互換email connectorが表示され、読取試験に成功した場合だけ使います。Metaの現在の日本向け案内はGmailを明記していますが、iCloudは明記していません。一般的なメール機能だけを根拠にiCloud対応と扱わず、未対応なら送信元を変えずにprivate iCloud adapterを使います。

互換connectorがある場合、Museは接続資格情報を利用者ごとのSecure VM内に保管し、agent自身へ秘密値を見せずに使います。Apple Account password、app-specific password、session cookieはkatazuku MCPへ渡しません。本文やOTPを正本へ複製せず、message ID、送信者、件名、要約、`muse-email:` sourceRefだけを`katazuku_record_mail`へ記録します。

返信は次の順で行います。

1. `katazuku_prepare_muse_email`で元メール、正本DB、日程、本文を検査しaction hashを固定する。
2. Museのemail connectorが宛先・本文を承認カードに表示し、sensitive writeの本人承認を毎回受ける。
3. 送信後にMuseがSentを再読し、同一message ID、送信元、宛先、件名、本文を照合する。
4. `katazuku_record_muse_email_result`へ承認ID、送信ID、Sent再照合ID、時刻、hashを返す。
5. 成否不明なら`unknown`で固定し、`katazuku_muse_email_status`が`reconciliationRequired`を返す。自動再送しない。

添付はMuse connectorの実際の証跡形式を確認するまでこの経路では受け付けません。ローカルiCloud adapterとMuse email connectorは
同じ送信元を使えても別Executorであり、相互にactionを横流ししません。
