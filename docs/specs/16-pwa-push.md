# spec16: katazuku PWA化と毎朝プッシュ通知

状態: スライス1・2実装済み(2026-07-28)。残り: iPhone実機での検証(本人)→スライス3(asa連携)・4(全アプリ展開)

実装メモ(2026-07-28):
- アイコンは第一候補(画像API)とフォールバックの両方を検証した。codex直のAPIスクリプト(`tools/gen-icon.mjs`)は
  権限制約で実行不可、codex CLI経由の画像生成は成功(`tmp/icon-ai.png`)。ただしAI生成の「片」は字形が微妙に
  崩れるため、採用はフォント描画のフォールバック(`tools/gen-icon-fallback.ps1`、Yu Gothic UI Bold)とした
- 購読保存先: Private Blob `push-subscriptions.json`。送信は `api/push-send`(write secret認証)+
  `scripts/push-send.mjs`。VAPID鍵は`.env`とVercel env(production/preview)に登録済み

## 目的

- iPhoneのホーム画面から1タップでkatazukuアプリ群を開ける(合言葉の毎回入力を撤廃)
- 毎朝「きょうやること」をスマホのプッシュ通知で受け取る(asaメールの補完)

## 設計方針

1. **PWA化**(landing/ 配下の各アプリ共通)
   - `manifest.webmanifest`: name=katazuku、display=standalone、テーマ色はSmartHRブルー、アイコン192/512/180(apple-touch-icon)
   - Service Worker: 最小構成(インストール可能要件+push受信)。オフラインキャッシュは正本と矛盾しない範囲(シェルのみ)に留める
   - **start_urlに合言葉(`?key=`)を含める**: ホーム画面追加時のURLに埋め込み、以後入力不要。合言葉はマニフェスト自体には書かず、追加時のURLで運ぶ(マニフェストは公開ファイルのため)
2. **Web Push**(iOS 16.4+はホーム画面追加済みPWAのみ対応)
   - 購読: アプリ内に「通知を有効にする」ボタン→ Push購読情報をapi経由でBlob/DBに保存
   - 配信: 毎朝のasa実行後に`web-push`(VAPID)で「きょうやること」要約を送るスクリプトを既存タスクスケジューラへ追加
   - VAPID鍵は`.env`(gitignore)に保管。購読情報も個人データとしてgit外
3. **アイコン**
   - 第一候補: codex側のOpenAI認証で画像API(gpt-image-1)を呼ぶ生成スクリプト(`tools/gen-icon.mjs`相当)。「片」の文字を核にしたアプリアイコンを生成
   - フォールバック: teal-500の「片」SVGを自作しPNG書き出し(SmartHRデザイン準拠)
   - iOSはマスク不可の不透明角丸なし正方形(180x180)が必要な点に注意

## 実装順(垂直スライス)

1. landing(トップ)だけをPWA化して合言葉埋め込みstart_urlでホーム画面追加を検証
2. Push購読の保存→手動送信スクリプトで1通届くところまで
3. asa連携(毎朝自動送信)
4. アイコン生成パイプライン→全アプリへ展開

## 制約・注意

- iOSのWeb Pushはユーザー操作(ボタン押下)からの許可要求のみ可
- 通知本文に個人名・企業名を細かく載せすぎない(ロック画面に出るため要約レベルに)
- 既存INFRA(Vercel kokotatan)の範囲でやる。新リソースを作ったらINFRA.mdに追記
