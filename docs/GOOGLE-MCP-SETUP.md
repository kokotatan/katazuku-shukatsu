# Google直結MCPセットアップ(claude.aiコネクタからの乗り換え)

claude.aiコネクタ(Gmail/カレンダー/Drive)はローカルのClaude Codeで不安定
(headlessでは一切使えない・環境変数で黙って無効化される)なため、
**Google Workspace MCP サーバーを自前で直結する**。これで対話・headless両方で
Gmail/カレンダー/Drive/Sheetsが使え、daily-syncのGmail処理も復活する。

使うもの: [taylorwilsdon/google_workspace_mcp](https://github.com/taylorwilsdon/google_workspace_mcp)
(uvxで起動。Gmail・Calendar・Drive・Sheets等が1サーバーに全部入り)

## 1. GCPコンソール(careerアカウントで。ブラウザ操作はClaude in Chromeで代行可)

1. https://console.cloud.google.com/ → プロジェクト選択(サービスアカウント用に作る/作った `katazuku-sync` と同じでよい)
2. 「APIとサービス」→ライブラリで有効化: **Gmail API / Google Calendar API / Google Drive API / Google Sheets API**
   (Sheets APIはサービスアカウント鍵の件=MINIPC-SETUP手順4とも共通。ここで一度に済む)
3. 「OAuth同意画面」: External / アプリ名 `katazuku` / 自分(careerアカウント)をテストユーザーに追加
4. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」→ 種別 **デスクトップアプリ**
   → クライアントIDとシークレットを控える(ファイル保存する場合はgitignore対象の場所へ)

## 2. Claude Code に登録(1コマンド)

```powershell
claude mcp add google-workspace --scope user `
  -e GOOGLE_OAUTH_CLIENT_ID=<クライアントID> `
  -e GOOGLE_OAUTH_CLIENT_SECRET=<シークレット> `
  -e USER_GOOGLE_EMAIL=okuyama.kotaro.career@gmail.com `
  -- uvx workspace-mcp --single-user --tools gmail calendar drive sheets
```

- `--scope user` なのでこのPC全体(どのフォルダのclaudeでも)で使える
- 確認: `claude mcp list` に google-workspace が Connected で出ること

## 3. 初回認証(1回だけ)

対話セッションで Gmail 系ツールを一度呼ぶ(例: 「gmailで未読を1件検索して」)。
ブラウザが開くので **careerアカウント** で承認する。以後トークンはローカル保存で自動更新。

## 4. 罠: トークン7日失効への対処

OAuth同意画面が「テスト」ステータスのままだと、**リフレッシュトークンが7日で失効**して週1再認証になる。
→ 同意画面で「アプリを公開」(本番にプッシュ)しておく。審査は不要(自分しか使わない)。
認証時に「Googleで確認されていないアプリ」警告が出たら「詳細」→「(安全でないページに)移動」で通す。
Gmailの制限付きスコープが本番×未審査でブロックされる場合はテストモード+週1再認証にフォールバック
(その場合、失効すると asa が「認証切れ」と報告するので気づける)。

## 5. 乗り換え後の追従修正(セットアップ完了時にやる)

- `scripts/daily-sync.ps1` の `--allowedTools`: `mcp__claude_ai_Gmail__*` を
  新サーバーの実ツール名(`mcp__google-workspace__*`。`claude mcp list` 後に対話で確認)に差し替える
- `scripts/daily-sync-prompt.md` / `scripts/asa-prompt.md` のツール名記述も同様に更新
- 動作確認: headlessで `claude -p "gmailで未読を1件検索して件数を報告"` が通ること
  (これが通れば毎朝8:23のdaily-syncのGmail処理が本当に動く)

## セキュリティ

- クライアントID/シークレットは `~/.claude.json`(ユーザースコープ)に保存される。**リポジトリには書かない**
- トークン類はworkspace-mcpがローカルの資格情報ストアに保存する。gitに入る場所には置かない
