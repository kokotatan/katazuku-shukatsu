# 保存先の手動設定（開発者向け）

Windows用のPC設定画面から保存先を作成する経路は[初回設定](GETTING-STARTED.md)を参照してください。以下は開発者が手動で自分のWorkerと非公開R2を配置する手順です。

## 準備

1. 自分のアカウントでR2を有効にします。
2. `cloudflare/wrangler.example.jsonc`を`cloudflare/wrangler.jsonc`へコピーし、Worker名とバケット名を設定します。
   `npm run build:apps`で全画面を組み立て、コピーした設定の`assets.directory`を`../web-dist`にします。exampleの`../web`は公開ゲート用の最小画面です。
3. `KATAZUKU_ALLOWED_ORIGINS`にGUIの正確なoriginを設定します。HTTPSのoriginをカンマで区切れます。ワイルドカード、パス、認証情報は許可しません。開発時のHTTPはloopbackだけです。
4. `KATAZUKU_DEVICE_NAME`に本人が画面で識別できるPC名を設定します。これは認証後だけ返します。
5. 読取・書込に別々の256bit以上のランダム値を生成し、base64url形式で秘密値として登録します。人が決めた短いパスワードには使いません。値をURLや公開ファイルに書かないでください。

```powershell
npx wrangler login
npx wrangler r2 bucket create katazuku-private
npx wrangler secret put KATAZUKU_READ_SECRET --config cloudflare/wrangler.jsonc
npx wrangler secret put KATAZUKU_WRITE_SECRET --config cloudflare/wrangler.jsonc
npm run cloudflare:check
npm run cloudflare:deploy
```

読取・書込キーが同じ、短すぎる、未設定、あるいは許可originが不正な場合は受付を停止します。設定ファイル、秘密値、データはコミットしません。

## 同期

`npm run snapshot`で、自分のDBから非公開の`data/snapshot.json`へ書き出します。`public/`には置きません。

手動導入では実行環境の`KATAZUKU_PUSH_URL`、`KATAZUKU_WRITE_SECRET`、`KATAZUKU_SOURCE_ID`を設定して`npm run snapshot:push`を実行します。`SOURCE_ID`は正本の初期設定時に生成して保持するUUIDです。送信ごとに作り直したり、別の正本に使い回したりしないでください。

PC設定画面による導入では、これらを`credentials/desktop-cloud.local.json`へ保存します。`npm run snapshot`と`snapshot:push`も同じ設定を読み、`npm run snapshot:sync`は選んだ正本から保存先確認・条件付き同期まで一度に実行します。PC設定アプリの起動中は変更を毎分確認します。

CLIは現在の版と正本の識別子を確認し、条件付きで更新します。不正なJSON、認証情報のフィールド、過大な本文、古いデータ、別の正本、同時更新を検出した場合、現在のデータを上書きしません。競合や成否不明を、無条件の再送で解消しないでください。

## 閲覧

- `GET /api/info`: プロトコルと保存先の識別子だけを返します。
- `POST /api/session`: 保存先の識別子とパスワード導出値、一度限りの端末連携コード、同一originのログインCookieを受け、30分間の閲覧セッションを発行します。旧読取キーはパスワード未設定の間だけ利用できます。
- `GET /api/data`: セッションのBearer認証が必要です。長期読取キーの直接利用とURLの`?key=`は廃止しました。
- `DELETE /api/session`: 現在のセッションを失効させます。キーの変更でも既存セッションを失効させます。
- `POST /api/pair`: 書込権限を持つPCが、許可済みorigin専用の5分間のコードを作ります。交換は同時に行っても一度だけ成功します。PC側UIとスマホ追加は未接続です。

CORSは正確なoriginだけを許可し、本人認証の代わりにはしません。データと認証応答は`no-store`です。長期キーはブラウザに保存せず、短期セッションだけをタブ内に保存します。解除に必要な通信が失敗しても画面内のデータは消えますが、サーバーの権限は有効期限まで残る可能性を表示します。

CloudflareのRate Limitingは乱用を抑える補助です。拠点ごとの緩やかな制限で、全世界を通じた厳密な回数保証ではありません。Bearerの期限切れレコードは定期処理で削除します。パスワード認証の方式は[初回設定と閲覧認証](PASSWORD-SETUP.md)を参照してください。

## 検証

`npm run test:cloudflare`はR2と条件付き書込をローカルのWorkersランタイムで検証します。これは実アカウント二つでの分離検証や、インストーラーの実機確認の代わりにはなりません。[公開前の確認項目](OSS-READINESS.md)を参照してください。

参考: [Cloudflare R2 API](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)、[Rate Limiting](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)。
