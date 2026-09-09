# Google接続・権限審査の進行状況

更新: 2026-09-09。対象は個人用katazukuと公開OSS。Google権限審査は未申請で、未確認アプリの警告は未解消。

## 完了した準備

- Googleプロジェクト `katazuku` のブランド、公開ホーム、データ取扱方針、ドメイン所有確認を設定。検証センターで「ブランディングは検証済みで、ユーザーに表示」と確認。
- 共通認証用Webクライアント `katazuku-common-google` を作成。既存の個人用デスクトップクライアントは維持。
- 認証中継を `https://katazuku-google.kotalabo.com` に公開。コールバックは `/callback`。クライアント秘密鍵とstate署名鍵はWorkers Secretで管理。
- PCの接続UIとPKCE・署名state・本人アカウント照合・既存資格情報保護・読み取り診断を実装。模擬Googleとの往復試験、型検査、Workers dry-run成功。
- Google Data Accessに9権限、各権限の用途説明、DriveとGmailの生産性用途を保存。動画URLは未入力。保存完了の通知を確認。
- 認証中継を通るコード・トークンの処理を公開のGoogleデータ取扱方針へ追記して再公開。
- `--record-demo` で本人が選んだChromeウィンドウを録画し、PCへ保存する入口を追加。録画対象の選択は本人操作待ち。
- 個人用 `npm run build`、OSS `npm run check`、個人情報blocklist付きの公開ゲートを2026-09-09に再実行して成功。
- 公開ブランチ `codex/google-workspace-setup` に `395cec4` をpushし、[draft PR #44](https://github.com/kokotatan/katazuku-shukatsu/pull/44) を作成。実認証・MCP実機結合とGoogle審査が完了するまでは完成版として扱わない。
- 個人用の既存接続では、Gmail・Calendar・Drive・Sheetsの実APIが応答することを確認。これは新しい共通クライアントの実認証・審査完了を意味しない。

## 共通接続の権限

`openid`、`userinfo.email`、`userinfo.profile`、`gmail.modify`、`calendar.readonly`、`calendar.events`、`drive.readonly`、`drive.file`、`spreadsheets` の9項目。
旧接続は17項目のまま。共通接続の実機確認後に移行し、MCPの認証や更新で余分な権限を再要求しないことを確認する。

## 管理アカウントと公開連絡先（2026-09-09本人訂正）

- 開発・管理用は `okuyama.kotaro@gmail.com` を使う意向。gcloudの現在のログインもこのアカウント。
- 2026-09-09 21:43 JSTのIAM照会では、プロジェクト `katazuku`（597636512611）の所有者は `okuyama.kotaro.career@gmail.com` だけ。メインアカウントではIAMを読めず、まだ管理権限がない。
- メインアカウントを所有者として追加し、既存careerの権限は維持する変更を本人に確認中。回答を得る前にIAMを変更しない。
- Googleデータの接続先はキャリア用のまま。開発用の管理アカウントと混同しない。
- 一般公開時の利用者向け窓口は `contact@kotalabo.com` が本人の候補。受信可否とGoogleのサポートメール欄で選択できる状態を確認したうえで採用する。現時点では変更していない。

## 残る作業

1. 保存済みの9権限と用途説明に、完成した実演動画のURLを追加する。
2. 共通クライアントで実際のGoogle同意→PCへの資格情報保存→4サービス利用を確認する。本人の認証・未確認アプリ警告の操作は本人が行う。
3. ローカルMCPの起動と更新トークンを共通接続へつなぐ。個人用の稼働中接続を壊さずに移行する。
4. 実際のOAuth同意と各権限を使う機能を撮影する。Googleの要求に沿い、実際のURL・クライアントID・英語の同意画面を含める。成功場面を捏造しない。
5. 公開済みdraft PR #44に、実機結合確認の結果と必要な修正を反映して完成させる。
6. レビュー可能な実動画・用途説明・実データの処理経路を揃え、最終提出を行う。Googleの追加質問・セキュリティ評価の判断を受けて対応する。
7. 審査完了後、個人用とOSSの実接続で警告が消えたことを確認する。

審査用動画はまだ完成していない。ブランド審査とデータアクセス審査、API接続成功は別の状態として扱う。

## 再開位置

2026-09-09 21:33 JSTにノートPCの `http://127.0.0.1:49676/` で再起動（プロセス30308）。Chromeの「Google連携 | katazuku」タブを本人操作用に残している。
本人が録画を開始し、Googleの認証操作を進めた。認証結果がPCへ戻った後、認証中継のHTTP 503で接続失敗。新しい資格情報はまだ保存されていない。
原因はWorkers実行環境が `redirect: 'error'` を拒否すること。架空の資格情報だけを使い、workerdで同じ例外を再現した。`manual` と3xxの明示拒否へ修正し、個人用 `npm run build`・`check:google-workspace`、OSS `npm run check` が成功。実Workerソースをworkerdでも実行し、Googleへの通信成立を確認した。
認証中継へバージョン `725ce432-58f3-4909-b5b4-c913e6f189a5` を反映済み。架空の更新トークンを使う本番確認はHTTP 503からGoogleの `invalid_grant` に変わり、通信エラーは解消。本人による新しい認証と資格情報保存の成功はまだ確認していない。
録画は21:41 JSTに停止し、`C:\Users\okuya\Downloads\katazuku-google-demo-2026-09-09T12-41-54-430Z.webm` に保存済み（VP9、1898×1318、8,312,400 bytes）。成功した全機能の審査動画ではなく、未公開の素材として扱う。
接続先アカウントはキャリア用。保存先は `logs/google-common-review-credentials/` に分離し、稼働中の既存接続は上書きしない。
プロセスが終了していたら、同じPCで次のコマンドを起動し、出力された新しいURLを開く。

```powershell
node tools/google-workspace/connect.mjs --account okuyama.kotaro.career@gmail.com --credentials-dir logs/google-common-review-credentials --record-demo
```

本人が録画対象を選んだ後にGoogle接続を開始する。Googleの警告・同意・本人確認は本人へ引き渡す。
録画中の元タブは閉じない。単なる接続診断で全機能の実演を済ませたと扱わない。

## 作業場所

- 個人用: このリポジトリの `google-auth/`、`tools/google-workspace/`、`site/google-content.mjs`。
- 公開用の隔離worktree: `C:\Users\okuya\katazuku-google-oauth-oss`、ブランチ `codex/google-workspace-setup`。
- 秘密情報は `credentials/` とWorkers Secret。公開用へコピーしない。
- 別タスクの「みんなのTODO」とはGoogleプロジェクト・クライアント・動画を分離する。

## 公式要件

- [制限付きスコープの審査](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification)
- [デモ動画の要件](https://support.google.com/cloud/answer/13804565?hl=en)
- [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)
