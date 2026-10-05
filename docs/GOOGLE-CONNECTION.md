# GoogleとAIの接続を確認する

`npm run doctor -- --setup` はローカルの準備だけを調べます。メール、設定値、資格情報の内容は表示せず、通信・ログイン・トークン更新もしません。
「確認済」は実接続の成功を意味しません。次の順に、自分で接続と読み取りを確認してください。

## 1. 自分の設定とOAuthクライアント

[SETUP.md](SETUP.md) の1〜2に沿って個人設定と自分のGoogle Cloudプロジェクトを作ります。
`.env.example` を `.env` にコピーし、OAuthクライアント情報を入力します。保存済みトークンにクライアント情報がある場合は、同じ値を二重に書く必要はありません。
雛形のアカウント・呼び名・署名では実利用の診断は通りません。

## 2. 読み取り専用で接続する

自分で作った **デスクトップアプリ** のOAuthクライアントを `.env` に指定してから実行します。認証画面の操作と許可は本人が行います。

```sh
npm run google:connect
npm run google:connect -- --account main   # 主アカウント以外: 設定済みのIDを指定
```

OSの既定ブラウザが開きます。個人設定と同じGoogleアカウントを選び、表示された権限を確認してください。
5分以内に完了しない場合やCtrl+Cで中止した場合は保存しません。設定と違うアカウント、未確認メール、権限の不足・余分な書込み権限も拒否します。

| 要求する権限 | 使い道 |
|---|---|
| `openid` / `email` | GoogleのUserInfoで本人確認済みメールが設定と一致するか確認 |
| `gmail.readonly` | 日次同期でメールを読む。就活メールだけに権限を限定するものではなく、メール全体の読取り権限 |
| `calendar.readonly` | 表示可能なカレンダー・予定を読む |

接続時の診断で読むのはGmailのアカウント情報とカレンダー一覧の最初のページです。メール本文・予定内容を表示・保存せず、件数・メールアドレス・保存パス・認証URL・秘密値も出力しません。
本人確認と読み取りAPIが成功した後だけ `google.credentialsDir` にJSONを保存します。既定は `~/.google_workspace_mcp/credentials` で、既存の取得スクリプトがそのまま再利用できます。

保存先は **リポジトリ外の本人のホーム配下** にしてください。クラウド同期フォルダは避けます。
POSIXではディレクトリ0700/ファイル0600、Windowsでは新規ファイルだけに本人SIDのACLを設定します。個人アカウントと学校・職場のEntraアカウントに対応します。
Google同意前に空の一時ファイルで作成・権限設定を検査して削除し、保存時にも再度保護します。既存のMCPファイルやディレクトリの権限は変えません。
Windowsの本人SID/ACL設定、排他的なファイル保存を使えない環境では保存を中止します。
現行のMCPと取得スクリプトでファイル名が一致する通常のアカウント表記を対象とし、`+`付きなどの別名は新規保存の対象外です。

**既存資格情報は上書きしません。** すでにMCPで認証済みなら再接続せず、次の確認だけを使います。

```sh
npm run google:connect -- --check
npm run google:connect -- --check --account main
```

`--check` は保存済みrefresh tokenからアクセストークンを取得し、本人確認と読み取りAPIだけを確認します。資格情報ファイルは変更しません。
この確認にはUserInfoの本人確認権限も必要です。既存資格情報で不足していても、勝手な権限追加やファイル削除は行いません。

成功しても **メール下書き・送信・予定の書込みはできません**。メール見張りや朝のまとめ等のツール工程には、次のMCP接続を本人が別に行い、必要な権限を確認してください。
第三者へのメール送信は従来どおり本人が行い、katazukuの工程は下書きまでです。
読取り成功はMCP・AI・定期実行の準備完了を意味しません。MCP側で追加同意が必要な場合も、本人がその画面を確認します。
Googleのインストール型アプリは段階的な権限追加に対応しないため、このCLIは自動で権限を拡張しません。

ブラウザが開かない場合はOSの既定ブラウザ、Googleが拒否する場合はデスクトップのクライアント種別・テストユーザー・APIの有効化・組織のポリシーを確認してください。
再ログインが必要な場合、既存ファイルを自動削除せず、使用している接続方式の手順を確認します。秘密をIssueや診断ログへ貼らないでください。

設計は [GoogleのデスクトップOAuth手順](https://developers.google.com/identity/protocols/oauth2/native-app) と
[GoogleのOpenID Connect仕様](https://developers.google.com/identity/openid-connect/openid-connect) に基づきます。
システムブラウザ・127.0.0.1のloopback・毎回のstate/S256 PKCEを使い、接続先はGoogleのHTTPSエンドポイントに固定しています。
OAuth応答・拒否・保存保護は合成テストで検証しています。実際の本人によるGoogle認証の成功は、このテスト結果とは別に確認してください。

## 3. workspace-mcpをCLIへ登録する

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

## 4. MCPで本人がGoogleで許可し、読み取りだけを確認

CLIへ「設定した自分のアカウントのカレンダー一覧を読み取りだけで確認して」と依頼します。
初回に案内されるGoogleの認証画面で、本人が対象アカウントと権限を確認して許可します。
メール送信・下書き作成・ラベル変更・予定作成は接続確認に使いません。
Google Cloudで有効にしたAPIと、本人が許可した権限が対象サービスと一致していることも確認してください。

保存先が既定の `~/.google_workspace_mcp/credentials` と異なる場合は、`google.credentialsDir` に実際の保存先を設定します。
katazukuが再利用するのは、対象アカウントのJSONにある `refresh_token` とOAuthクライアント情報です。
別の保存形式や暗号化ストアはそのままでは読めません。秘密を公開したり、診断結果へ貼ったりせず、workspace-mcp側の保存方法を確認してください。

## 5. 診断してから初回の同期へ

```sh
npm run doctor -- --setup
npm run workflow -- daily-sync --dry-run
npm run workflow -- mail-watch --dry-run
```

ローカル診断に不足がなく、本人によるGoogleの読み取り確認も済んだら、[SETUP.md](SETUP.md) の確認・初回実行・定期登録へ進みます。
ChatGPTプラン/APIキーだけで動くのはツール不要の工程です。メール見張りや朝のまとめ等を有効にするにはClaude CodeかCodexも接続します。

診断はCLIログイン、Google権限、トークンの失効、利用枠、MCPの実接続、スケジューラ登録状態を検証しません。
「未確認」のまま運転開始済みと扱わず、定期登録後の成功ログと実データ更新まで確認してください。
