# katazuku 就活の公開HP

製品紹介、導入チュートリアル、記事、OSS参加導線を持つ静的サイト。

- 公開HP: `https://katazuku-shukatsu.kotalabo.com`
- Worker: `katazuku-shukatsu-site`
- 私用GUI: `https://katazuku-app.kotalabo.com`
- 公開HPのWorkerにR2、秘密値、私用データのバインディングは付けない。

## 作業

```powershell
npm --prefix site run build
npm --prefix site run check
npm --prefix site run preview
npx wrangler deploy --config site/wrangler.jsonc
```

Node.js標準モジュールだけでHTMLを生成する。Wranglerはリポジトリルートの既存依存を使う。
出力先はこのディレクトリの`dist/`。private GUIのルート`dist/`と混ぜない。

## 内容を直す

- ページ・導入手順: `build.mjs`
- 記事: `content.mjs`の`posts`。本文、出典、説明文を同時に更新する。
- 見た目: `public/site.css`
- メニュー、コピー、OS選択: `public/site.js`
- 記事のHTML、Markdown、RSS、サイトマップ、構造化データ、llms.txtはビルドで生成。

公開機能の説明は実際のOSSと一致させる。現時点では公開版にGoogleコネクタ、日記の自動生成、GUIを含むCloudflare一括導入はない。npmはコアライブラリであり、GUIはGitHubに含まれる。

## 検証（2026-09-08）

- 16 HTML（公開15ページと404）のリンク・アンカー・メタ情報・構造化データを検査。
- PCと390px幅のスマホ表示、メニュー、OS切り替え、コマンドコピーを確認。
- GitHubから新規取得し、Node.js 24で`npm install`、`npm run doctor`、`npm run snapshot -- --demo`、boardのinstall/build/devを実行。
- 本文はJavaScriptなしでも読める。404は実際に404を返す。Cloudflare側でWeb Analyticsが自動挿入されることを確認し、プライバシーページに記載。
- note用原稿は`docs/launch/note-katazuku-start-20260908.md`。noteへは未投稿。

## 検索・編集の参照

- https://developers.google.com/search/docs/appearance/ai-features
- https://developers.google.com/search/docs/fundamentals/using-gen-ai-content
- https://developers.cloudflare.com/workers/configuration/routing/workers-dev/

検索への登録や順位は公開そのものとは別。記事の実用性、出典、最新の機能との一致を保つ。
