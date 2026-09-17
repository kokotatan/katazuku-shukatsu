# Google Workspaceの接続と審査

katazukuのコアと閲覧アプリは、Googleに接続しなくても架空データで利用できます。
Googleを使う場合は、利用者自身のアカウントと実行環境で接続します。
共通「Googleで接続」の認証中継とPC画面を実装しています。現在は実機確認・権限審査の準備中です。
Googleから承認済みのアプリとしては提供していません。一般利用向けの完成版ではありません。

## 共通接続を確認する

このリポジトリを取得したPCで起動します。共通接続では、利用者がGoogle Cloudプロジェクトを作ったり、
作者のクライアント秘密鍵を受け取ったりする必要はありません。

```sh
npm run google:connect -- --account person@example.com
```

表示された `http://127.0.0.1:<port>/` を同じPCで開きます。「Google連携を開始」からGoogleへ移動し、
本人がアカウントと権限を確認します。アカウントが指定と一致した場合だけ、接続をそのPCへ保存します。
接続の既定保存先は `~/.google_workspace_mcp/credentials/<account>.json` です。
既存の別クライアントを置き換えるときは `--replace` を明示し、元のファイルは同じ保存先の
`.katazuku-backups/` へ退避します。保存先を分けて試す場合は `--credentials-dir <directory>` を指定します。

| 処理 | 場所 |
|---|---|
| 本人の同意 | Googleの画面 |
| 認可コード交換・トークン更新 | Cloudflare Workers上の共通認証サービス |
| 接続トークンの保存 | 利用者のPC |
| メール・予定・資料・シートの取得 | 利用者のPCからGoogle APIへ直接 |
| データの整理・保存 | 利用者のエージェントとDB |

共通認証サービスには認可コード・アクセストークン・更新トークンが通過します。
これらを永続ストレージやアプリのログへ保存せず、メール本文・予定・資料のAPI処理は中継しません。
AIサービスへ処理を依頼する場合のデータ送信は別に発生します。
[Googleデータの取扱方針](https://katazuku-shukatsu.kotalabo.com/google/privacy/)を確認してください。

要求する権限は `tools/google-workspace/scopes.mjs` の9項目です。
Gmailの整理、予定の読み取り・更新、既存Drive資料の検索・読み取り、アプリのファイル保存、既存シートの更新に使います。
Googleの同意を途中で取り消した場合や、別のアカウントを選んだ場合は、保存済み接続を上書きしません。

## MCPとの接続

既存のMCPクライアントから[Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp)を使えます。
共通接続はその資格情報形式で保存し、更新先を共通サービスの `/token` に設定します。
共通接続で使うクライアント秘密鍵をPCへ設定しないでください。

共通接続を保存した後、uvをインストールしたPCで専用のMCP入口を起動します。
MCPクライアントのcommandに `node`、argsに次のスクリプトの絶対パスとアカウントを設定します。

```sh
node tools/google-workspace/mcp.mjs --account person@example.com
```

保存先を分けた場合は同じ `--credentials-dir <directory>` を指定します。
専用入口はworkspace-mcp 1.23.0を隔離して起動し、9権限を使うGmail・Calendar・Drive・Sheetsのツールを公開します。
古いOAuth設定や秘密鍵を引き継がず、別アカウントへのアクセス、Gmail設定変更、カレンダー自体の作成などは拒否します。
接続の失効時は本ガイドの共通接続画面へ戻るよう案内し、MCP独自のOAuthフローは開始しません。
この入口は読み取り専用ではありません。メール送信・予定変更等には、本人確認とExecutorによる確定処理を組み込んでください。
架空資格情報で更新・失効・権限境界と実MCPプロセスの48ツールを検証済みです。
共通接続の実Google同意・実APIによる最終確認は継続中で、審査完了を意味しません。
MCP接続だけでは、定期同期やkatazukuのDBへの書き込みは始まりません。
取得内容を各 `src/db-apply*.ts` の入力へ変換し、エージェントの処理に接続する必要があります。

独自のGoogleプロジェクトを使う場合は、MCPの公式手順でGmail・Calendar・Drive・Sheets APIと
デスクトップ用OAuthクライアントを設定します。その環境の非公開設定に `GOOGLE_OAUTH_CLIENT_ID`、
`GOOGLE_OAUTH_CLIENT_SECRET` を保存します。作者のトークンや秘密鍵は配布しません。

## 接続を診断する

開発時の隔離試験は次のコマンドで実行できます。架空資格情報のみを使用します。
Python側の更新試験はGoogleへの通信を模擬し、MCPプロセス試験はツール一覧と拒否される呼び出しを確認します。

```sh
uvx --from workspace-mcp==1.23.0 python tools/google-workspace/check_mcp_runtime.py
node tools/google-workspace/check-mcp-process.mjs
```

Google Workspace MCPの保存済み資格情報を読み、状態だけを表示します。
トークンやAPI応答のメール本文・ファイル名は表示しません。

```sh
node tools/google-workspace/doctor.mjs --account person@example.com
node tools/google-workspace/doctor.mjs --account person@example.com --online
```

`--online` はトークンを更新し、アカウントが一致することを確認して、Gmail・Calendar・Driveを読み取ります。
メール送信・ラベル変更・予定作成・DB書き込みはしません。
Sheetsも確認する場合は、自分が閲覧できるシートのIDを `KATAZUKU_GOOGLE_SPREADSHEET_ID` に設定します。
未指定の場合は `not_checked` です。保存場所を変えた場合は `KATAZUKU_GOOGLE_CREDENTIALS_DIR` を指定できます。
更新先はGoogleと公式共通サービスに限定しています。自分で中継を運用する場合は、診断時にも
`--broker https://auth.example.com` を明示します。資格情報内の任意URLへトークンを送ることはしません。

`connected` はAPI接続の成功です。Googleによる審査済みを意味しません。
`reauthentication_required` は再認証が必要、`account_mismatch` は別アカウントのため処理を停止した状態です。

## 未確認アプリの警告

Google Cloudの「本番環境」への切り替えと、OAuth権限審査の承認は別の手続きです。
本人用の少人数アプリは審査免除の対象となり得ますが、警告の解除を意味しません。
警告を消すには、実際に要求する権限をGoogle Auth Platformのデータアクセスへ登録し、
ブランド・権限の審査を完了する必要があります。

他の人がフォークして独自のOAuthプロジェクトを使う場合、そのプロジェクトにも独自の設定・審査が必要です。
作者のアプリが承認されても、別のOAuthプロジェクトが自動的に承認されることはありません。

## 共通認証サービスの運用

`google-auth/wrangler.example.jsonc` を `google-auth/wrangler.jsonc` へコピーし、
HTTPSの公開オリジン、GoogleのWebクライアントID、独自ドメインのrouteを設定します。
Google側の承認済みリダイレクトURIは `<公開オリジン>/callback` と完全に一致させます。
クライアント秘密鍵とランダムな署名鍵は `wrangler secret put` で登録し、設定ファイルへ直書きしません。

```sh
npx wrangler secret put GOOGLE_CLIENT_SECRET --config google-auth/wrangler.jsonc
npx wrangler secret put STATE_SIGNING_SECRET --config google-auth/wrangler.jsonc
npm run google-auth:check
npx wrangler deploy --config google-auth/wrangler.jsonc
```

署名鍵には暗号学的な乱数を32バイト以上使います。`/metadata` の `configured` は構成の確認です。
Google審査の承認を表しません。OAuthのコードやトークンを記録しないため、実行ログは無効にしています。
独自運用では、利用者数に応じた濫用対策、Google側の上限、障害対応と審査の運用も必要です。

実演を録画する場合は `google:connect` に `--record-demo` を付けます。本人がChromeのウィンドウを選び、
アドレスバーを含む実画面を録画できます。動画はPCへ保存し、自動アップロードしません。
この機能はOAuth部分の録画手段です。Googleの審査には各権限を使う実機能と、プロジェクト内の全クライアントの実演も必要です。

## データの扱い

Googleデータは必要な用途だけに使い、AIに読ませる場合は送信先と保持・学習設定を確認してください。
接続の取り消しは[Googleアカウントの接続管理](https://myaccount.google.com/connections)から行います。
取り消しだけでは、端末・DB・ログ・バックアップに保存した情報は消えません。
同期を停止して、不要な保存データを自分の環境から削除してください。

公式資料：

- [Googleの審査免除と警告](https://support.google.com/cloud/answer/13464323?hl=en)
- [制限付き権限の審査と実演動画](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [デスクトップアプリのOAuth](https://developers.google.com/identity/protocols/oauth2/native-app)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
