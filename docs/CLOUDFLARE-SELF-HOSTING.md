# Cloudflareへのセルフホスト

Cloudflare連携は任意です。標準構成はローカルSQLiteとローカルの`snapshot.json`だけで動きます。
複数端末から読み取りたい場合に限り、利用者自身のCloudflareアカウントへWorkerとR2を配置できます。

このリポジトリの作者が運営するCloudflareアカウント、Worker、バケット、ドメイン、認証サーバーは使いません。
`wrangler login`の認証先、R2の利用料金、秘密情報、データの管理責任はすべてデプロイした利用者にあります。

## セットアップ

1. [Cloudflare R2](https://developers.cloudflare.com/r2/get-started/)を自分のアカウントで有効化します。
2. 設定テンプレートをコピーし、Worker名とバケット名を自分用に変更します。

```powershell
Copy-Item cloudflare/wrangler.example.jsonc cloudflare/wrangler.jsonc
npx wrangler login
npx wrangler r2 bucket create katazuku-private
```

3. 読み取り用と書き込み用に、別々の32 byte以上のランダム値を設定します。
   未設定・短すぎる値・両方が同じ値の場合、Workerはfail-closedで503を返します。
   値はリポジトリへ書かず、対話入力します。

```powershell
npx wrangler secret put KATAZUKU_READ_SECRET --config cloudflare/wrangler.jsonc
npx wrangler secret put KATAZUKU_WRITE_SECRET --config cloudflare/wrangler.jsonc
```

4. 検査してから、自分のCloudflareアカウントへデプロイします。

```powershell
npm run cloudflare:check
npm run cloudflare:deploy
```

5. ローカルでスナップショットを生成し、自分のWorkerへ送信します。

```powershell
npm run snapshot
$env:KATAZUKU_PUSH_URL='https://自分のWorker.workers.dev'
$env:KATAZUKU_WRITE_SECRET='自分の書き込み用秘密値'
npm run snapshot:push
```

読み取りは`GET /api/data`へ`Authorization: Bearer <KATAZUKU_READ_SECRET>`を付けます。
既存の閲覧アプリとの互換用に`?key=`も使えますが、URLが履歴やログへ残り得るためBearer認証を推奨します。
別オリジンの閲覧アプリからBearer認証を使うためのCORS preflightにも対応しています。

## データ境界

- R2へ置くのは閲覧用スナップショットだけです。SQLite正本はローカルから動かしません。
- スナップショットにはパスワード、Cookie、OAuthトークン、メール本文、顔写真を含めません。
- `cloudflare/wrangler.jsonc`、`.dev.vars`、`.env`はコミットしません。
- 作者のWorker URLやCloudflareアカウントIDを既定値・フォールバック先として使いません。
- Cloudflareを使わない利用者は、この文書の手順を一切行う必要がありません。
