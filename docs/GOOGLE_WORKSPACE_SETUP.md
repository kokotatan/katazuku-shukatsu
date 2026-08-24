# Google Workspace連携を利用者ごとに設定する

katazukuのOSS版は、配布元のGoogleアカウントやOAuthクライアントを共有しません。
利用者ごとに次の3つを作り、自分のkatazuku環境だけへ保存します。

- 自分のGoogle Cloudプロジェクト
- そのプロジェクト内のデスクトップ用OAuthクライアント
- katazukuで扱う自分のGoogleアカウント

このため、別の人がkatazukuをcloneしても、配布元や他の利用者のGmailへつながることはありません。

## 1. Google Cloud側を準備する

1. [Google Cloud Console](https://console.cloud.google.com/)で、自分専用のプロジェクトを作成します。
2. APIライブラリで次を有効化します。
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - Google Sheets API
3. Google Auth Platformの「Branding」「Audience」「Data Access」を設定します。
   個人のGoogleアカウントで使う場合は、AudienceをExternalにし、Testing中は自分のアカウントをテストユーザーへ追加します。
4. 「Clients」でOAuthクライアントを作成し、Application typeは必ず「Desktop app」を選びます。
5. 作成したクライアントのJSONをダウンロードします。

ウェブアプリ用クライアントや、配布元のOAuthクライアントは使いません。

## 2. ローカルへ設定する

[uv](https://docs.astral.sh/uv/getting-started/installation/)をインストールし、`uvx --version`が成功することを確認します。
その後、リポジトリ直下で次を実行します。

```sh
npm run setup:google -- --credentials /path/to/client_secret.json --email you@example.com
```

OAuthクライアント情報はGit管理下ではなく、OSの利用者別領域へ保存されます。

| OS | 保存先 |
|---|---|
| Windows | `%LOCALAPPDATA%\katazuku-shukatsu\google-workspace.json` |
| macOS | `~/Library/Application Support/katazuku-shukatsu/google-workspace.json` |
| Linux | `${XDG_CONFIG_HOME:-~/.config}/katazuku-shukatsu/google-workspace.json` |

既存設定を意図的に置き換える場合だけ、末尾へ`--force`を付けます。セットアップ後、ダウンロードしたJSONは
リポジトリ外へ移すか安全に削除してください。`.gitignore`と秘密情報スキャンも一般的なファイル名を遮断しますが、
それだけに依存しないでください。

## 3. Claude CodeまたはCodexから初回認証する

リポジトリには、秘密を含まない次のプロジェクト設定が入っています。

- Claude Code: `.mcp.json`
- Codex: `.codex/config.toml`

どちらも同じ`google-workspace` MCPブリッジを起動します。プロジェクトのMCP利用を承認したうえで、
初めてGmailまたはCalendarのツールを使うと、ブラウザでGoogleの認可画面が開きます。
そこで手順2の`--email`に指定した自分のアカウントを認証します。

katazukuのagent-runtimeは、Gmail・Calendar・Drive・SheetsについてClaude.ai内蔵コネクタへ
フォールバックしません。したがって、Claude.ai側で別のGmail認証を求められても、katazukuの自動処理には不要です。

## 4. 7日ごとの再認証を止める

Google OAuthのPublishing statusがTestingのままだと、Gmailなどのスコープを含む認可は通常7日で失効します。
個人用の設定が動作したら、Google Auth Platformの「Audience」で「Publish app」を実行し、
Publishing statusをIn productionへ切り替えます。

個人利用で100ユーザー未満なら、Googleの検証を完了していないIn productionアプリも利用できますが、
認可時に「未確認のアプリ」の警告とユーザー上限が残る場合があります。各利用者が自分専用のOAuthアプリを作る
この構成では、配布者が全利用者のGoogleデータへアクセスする形にはなりません。

参考:

- [Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp)
- [OAuth consent screen and app publishing status](https://support.google.com/cloud/answer/15549945?hl=en)
- [Unverified apps](https://support.google.com/cloud/answer/7454865?hl=en)

## 切り分け

- `Google Workspaceが未設定です`: 手順2を実行します。
- `uvx`を起動できない: uvをインストールし、ターミナルを開き直します。
- 7日後に再認証を求められる: Google Cloud側がTestingのままか確認します。
- 別アカウントが開く: `--force`付きで正しいメールアドレスへ設定し直し、ブラウザの認可画面でも同じアカウントを選びます。
- Claude.aiのGmail認証が出る: Claude.ai内蔵コネクタの画面です。katazukuでは`google-workspace` MCPを選びます。
