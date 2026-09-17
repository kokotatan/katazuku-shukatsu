# Google Workspaceの接続と審査

katazukuのコアと閲覧アプリは、Googleに接続しなくても架空データで利用できます。
Googleを使う場合は、利用者自身のアカウントと実行環境で接続します。
現在、全利用者向けの共通「Googleで接続」は審査・導入を準備中です。
Googleから承認済みのアプリとしては提供していません。

付属の接続画面を使う場合も、作者の認証サービスへは接続しません。利用者自身が管理するHTTPSの
OAuth brokerを`KATAZUKU_GOOGLE_BROKER_ORIGIN`または`--broker`で明示してください。

## 自分の環境へ接続する

既存のMCPクライアントから[Google Workspace MCP](https://github.com/taylorwilsdon/google_workspace_mcp)を使えます。
その公式手順に従って自分のGoogle CloudプロジェクトでGmail・Calendar・Drive・Sheets APIを有効にし、
デスクトップ用OAuthクライアントを設定してください。作者の秘密鍵や接続トークンは配布しません。
Googleの同意・本人確認は、MCPを動かすPCのブラウザで本人が行います。

最初の読み取り確認には、バージョンを固定して起動します。クライアントID・シークレット・アカウントは
利用するMCPクライアントの非公開の環境変数に設定してください。
リポジトリやIssue、スクリーンショットへ貼り付けないでください。

```sh
uvx workspace-mcp==1.23.0 --tools gmail calendar drive sheets --read-only
```

設定する変数は `GOOGLE_OAUTH_CLIENT_ID`、`GOOGLE_OAUTH_CLIENT_SECRET`、`USER_GOOGLE_EMAIL` です。
読み取り設定ではメール送信・予定作成・シート更新はできません。これらは、必要な権限の追加と
本人確認・Executorによる確定処理を組み込んでから利用してください。
MCP接続だけでは、定期同期やkatazukuのDBへの書き込みは始まりません。
取得内容を各 `src/db-apply*.ts` の入力へ変換し、エージェントの処理に接続する必要があります。

## 接続を診断する

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

`connected` はAPI接続の成功です。Googleによる審査済みを意味しません。
`reauthentication_required` は再認証が必要、`account_mismatch` は別アカウントのため処理を停止した状態です。

## 未確認アプリの警告

Google Cloudの「本番環境」への切り替えと、OAuth権限審査の承認は別の手続きです。
本人用の少人数アプリは審査免除の対象となり得ますが、警告の解除を意味しません。
警告を消すには、実際に要求する権限をGoogle Auth Platformのデータアクセスへ登録し、
ブランド・権限の審査を完了する必要があります。

他の人がフォークして独自のOAuthプロジェクトを使う場合、そのプロジェクトにも独自の設定・審査が必要です。
作者のアプリが承認されても、別のOAuthプロジェクトが自動的に承認されることはありません。

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
