# Museとの接続

MetaはMuseを、接続済みアプリやWebを横断して背景実行でき、重要操作の承認と監査履歴を持つ
パーソナルエージェントとして説明しています。Muse Spark 1.1の公式発表では、モデルが新しいMCP serverと
custom skillへzero-shotで適応できるとも明記されています。

- [Muse公式](https://ai.meta.com/muse/)
- [Muse Spark 1.1公式発表](https://ai.meta.com/blog/introducing-muse-spark-meta-model-api/)

## 2つの接続面

### 1. SkillをMuseへ配る

AgensiはMuseを対応agentとして掲げ、Agensi MCP経由でSKILL.mdを都度読み込む方式を案内しています。
この経路は「katazukuをどう使うか」という手順・判断基準・安全境界をMuseへ渡すものです。

- [AgensiのMuse marketplace](https://www.agensi.io/muse-marketplace)
- [Agensi MCPのOAuth仕様](https://www.agensi.io/docs/mcp-server)

Skillだけでは利用者のローカルSQLiteへ接続できません。Agensi自身も、skillはagentの働き方を変え、
plugin/MCP serverはAPI・DB・toolという能力を追加する別物だと区別しています。

### 2. katazuku MCPを接続する

このリポジトリの`npm run mcp`が、正本DBへつながる標準MCP serverです。Muse側で任意のMCP serverを
登録できる環境では、[MCPガイド](MCP.md)のStreamable HTTP endpointを登録します。

remote接続に必要なOAuth 2.1 gatewayと端末へのprivate relayは`muse-gateway/`に実装しています。DB、Google資格情報、
tool payloadはCloudflareへ永続化せず、OAuth scopeと端末側allowlistの両方で制限します。導入手順は
[gateway README](../muse-gateway/README.md)を参照してください。

Metaの公開ページでは、モデルのMCP対応は確認できましたが、Muse製品で利用者独自のremote MCPを登録する
画面、OAuth metadata、redirect URI、審査手順の公開仕様までは確認できませんでした。したがって、gatewayを
実装済みでもMuse実機接続済みとは扱わず、画面名や未公開URLを推測しません。実機でconnector追加画面が提供された
時点で、次を照合して接続します。

1. transportがStreamable HTTPであること
2. OAuth 2.1または同等の利用者認証を要求できること
3. toolごとの承認表示とscopeが確認できること
4. `read`だけで接続し、tool一覧と架空DBで疎通すること
5. `sensitive`、`write`、`actions`を一つずつ追加すること
6. `katazuku_prepare_action`が実行せず`needs_user`で止まることを確認すること

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

