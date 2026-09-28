# Spark用HTTPS・OAuth接続

Sparkのカスタムアプリに`https://<専用ホスト>/mcp`を登録し(PCブラウザの gemini.google.com/apps から)、スマホから調査・草案の依頼、進捗、結果を扱う。
常駐PC(自宅のミニPC等)のbridgeが外向きに接続するので、ルーターや常駐PCの待受ポートを公開しない。
OAuth用KVと中継用Durable Objectだけを使用する。正本DB・写真・既存アプリのストレージはバインドしない。

## 初期設定

1. このディレクトリで`npm ci`を実行する。
2. `wrangler.example.jsonc`を`wrangler.jsonc`へコピーし、専用Worker名・PUBLIC_ORIGIN・KV namespace・必要ならcustom domainを設定する。
3. `node setup-secrets.mjs`で専用キーを生成する。`owner-key.local.txt`は本人の接続確認に使い、`secrets.local.json`は`wrangler secret bulk secrets.local.json`で投入する。どちらもgit対象外。チャット・URL・ログに貼らない。
4. `npm run check`と`wrangler deploy --dry-run`が成功してから`npm run deploy`。
5. 常駐PCの`logs/spark-bridge.local.json`に`{"origin":"https://<専用ホスト>","token":"<BRIDGE_TOKEN>"}`を保存する。鍵ファイルの読取権限を本人アカウントに限定する。
6. 常駐PCで`scripts/register-spark-bridge.ps1`を実行する。常駐接続は切断時に1秒から60秒のバックオフで再接続する。5分間隔のタスクが停止後の復旧を補う。
7. PCブラウザの gemini.google.com/apps 下部「Sparkのカスタムアプリ」でURLを入力し、Google側の接続同意と、このgatewayの専用接続キーによる同意を行う。

接続キーはパスワードマネージャー等に保管する。APIにはOAuthトークンを使用し、接続キーをSparkのチャットやタスク本文へ入力しない。
キー変更だけでは既存OAuth grantは失効しない。アクセスを取り消す場合はSpark側の接続解除に加え、OAuthライブラリのrevokeGrantで該当grantを失効させる。

## 公開範囲

`spark_enqueue`、`spark_status`、`spark_list`のみ。依頼内容と草案は接続したSparkアカウントが取得できる。
`spark_claim`、`spark_report`、任意SQL・シェル、承認、メール送信、予約確定は公開しない。
bridge側でも同じ固定リストを検証する。結果はneeds_reviewで止まり、既存Executorの承認を代替しない。

常駐PCでSparkへ送信するworkerには別途Claude Codeの有効なログインとChrome接続が必要。
gatewayが開通していても、workerの認証・拡張接続が切れていると依頼はblockedになる。
認証の復旧だけで成否不明の依頼を再送しない。履歴を照合し、既存URLをreconcileするか、未送信が確認できた場合だけ新しい依頼キーで登録する。

## 検証

`npm run check`はローカルworkerdでOAuth発見、本人キー、不正Origin、ブラウザ結合、同意・コード再利用、HTMLエスケープ、操作制限、中継、常駐PC切断を検証する。
`SPARK_GATEWAY_TEST_ORIGIN`を明示して`node check.mjs`を実行すると本番試験になる。実際に合成document依頼を1件登録し、常駐PCのworkerが処理する。自動CIでは実行しない。
本番試験の`smoke.local.json`に依頼IDを残す。個人データは使わない。

OAuth callbackや認証コードをログへ残さないため、この専用Workerのリクエストログは無効化する。
中継は依頼本文を永続化しない。切断時は503、20秒以内に返らなければ504。処理済みか不明の場合も同じrequestKeyを再利用する。
