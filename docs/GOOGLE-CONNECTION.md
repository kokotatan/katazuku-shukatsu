# GoogleとAIの接続を確認する

`npm run doctor -- --setup` はローカルの準備だけを調べます。メール、設定値、資格情報の内容は表示せず、通信・ログイン・トークン更新もしません。
「確認済」は実接続の成功を意味しません。次の順に、自分で接続と読み取りを確認してください。

## 1. 自分の設定とOAuthクライアント

[SETUP.md](SETUP.md) の1〜2に沿って個人設定と自分のGoogle Cloudプロジェクトを作ります。
`.env.example` を `.env` にコピーし、OAuthクライアント情報を入力します。保存済みトークンにクライアント情報がある場合は、同じ値を二重に書く必要はありません。
雛形のアカウント・呼び名・署名では実利用の診断は通りません。

## 2. workspace-mcpをCLIへ登録する

[uvの公式インストール手順](https://docs.astral.sh/uv/getting-started/installation/) で `uvx` を使えるようにし、`uvx --version` で確認します。
katazukuのコアとは別に、Googleのツールを提供する [workspace-mcp](https://github.com/taylorwilsdon/google_workspace_mcp#quick-start) が必要です。
サーバー名は **google-workspace** にします。既存の能力判定とツール許可名がこの名前を使うためです。

`.env` はkatazukuのワークフローから読み込まれますが、手動起動したCLIには自動で渡りません。
次の例は [dotenv-cli](https://github.com/entropitor/dotenv-cli) を使って `.env` を読み込みます。
値をコマンド引数やチャットに貼る必要はありません。リポジトリのルートで実行してください。

### Claude Code

```sh
npx dotenv-cli --no-expand -e .env -- claude mcp add --scope local --transport stdio google-workspace -- uvx workspace-mcp --tools gmail calendar
npx dotenv-cli --no-expand -e .env -- claude
```

Claude Code内で `/mcp` を開き、サーバー接続を確認します。
登録済みなら重複追加せず既存設定を確認してください。
構文とスコープの詳細は [Claude CodeのMCP手順](https://code.claude.com/docs/en/mcp) を参照してください。

### Codex

現在のkatazukuはプロジェクト内の `.codex/config.toml` でGoogleの能力を判定します。
CLIのユーザー設定だけへ登録しても、katazukuのツール工程では認識できません。
リポジトリ直下に `.codex/config.toml` を作り、既存の内容があれば以下だけを追記します。
秘密値はこのファイルに書かず、環境変数として渡します。

```toml
[mcp_servers.google-workspace]
command = "uvx"
args = ["workspace-mcp", "--tools", "gmail", "calendar"]
env_vars = ["GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"]
```

```sh
npx dotenv-cli --no-expand -e .env -- codex
```

Codex内で `/mcp` を開き、サーバー接続を確認します。初回はプロジェクト設定の信頼確認が必要になる場合があります。
詳細は [CodexのMCP設定](https://developers.openai.com/codex/mcp/) を参照してください。

## 3. 本人がGoogleで許可し、読み取りだけを確認

CLIへ「設定した自分のアカウントのカレンダー一覧を読み取りだけで確認して」と依頼します。
初回に案内されるGoogleの認証画面で、本人が対象アカウントと権限を確認して許可します。
メール送信・下書き作成・ラベル変更・予定作成は接続確認に使いません。
Google Cloudで有効にしたAPIと、本人が許可した権限が対象サービスと一致していることも確認してください。

保存先が既定の `~/.google_workspace_mcp/credentials` と異なる場合は、`google.credentialsDir` に実際の保存先を設定します。
katazukuが再利用するのは、対象アカウントのJSONにある `refresh_token` とOAuthクライアント情報です。
別の保存形式や暗号化ストアはそのままでは読めません。秘密を公開したり、診断結果へ貼ったりせず、workspace-mcp側の保存方法を確認してください。

## 4. 診断してから初回の同期へ

```sh
npm run doctor -- --setup
npm run workflow -- daily-sync --dry-run
npm run workflow -- mail-watch --dry-run
```

ローカル診断に不足がなく、本人によるGoogleの読み取り確認も済んだら、[SETUP.md](SETUP.md) の確認・初回実行・定期登録へ進みます。
ChatGPTプラン/APIキーだけで動くのはツール不要の工程です。メール見張りや朝のまとめ等を有効にするにはClaude CodeかCodexも接続します。

診断はCLIログイン、Google権限、トークンの失効、利用枠、MCPの実接続、スケジューラ登録状態を検証しません。
「未確認」のまま運転開始済みと扱わず、定期登録後の成功ログと実データ更新まで確認してください。
