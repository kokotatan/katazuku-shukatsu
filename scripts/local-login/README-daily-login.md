# 自動ログインのGUI設定

Windows PCで、毎日ログインするサービス・ログインURL・認証方法・時刻を設定する。
Node.js 24とGoogle Chromeが必要。Gitから取得したリポジトリで使う機能で、npmのコアライブラリには含めない。

## 起動と初回設定

1. リポジトリの `scripts/open-local-login-settings.vbs` をダブルクリックする。
   またはルートで `npm run local-login:settings` を実行する。初回は画面の依存関係とビルドを準備する。
2. `http://127.0.0.1:18471/board/local-login/` の「サービスを追加」を押す。
3. サービス名を選び、本人が普段使っているHTTPSのログインURLと認証方法を指定する。
4. ID・パスワード方式は「ログイン情報を登録」から端末内に保存する。
   Google等のログイン状態を使う場合は「専用Chromeでログイン」を押し、本人がログインしてウィンドウを閉じる。
5. 毎日ログインしたいサービスを選び、時刻と「毎日の自動ログインを有効にする」を設定し、「設定を保存」を押す。

サービスの追加だけでは自動実行の対象に入らない。既存サービスのURL・認証方法は「接続先を変更」で編集できる。
URLや認証方法を変更した場合は新しい専用プロファイルを使い、以前の認証情報とセッションは再利用しない。
停止するときは「毎日の自動ログインを有効にする」を外して保存する。

## 初期候補は正式名称だけ

`portal-presets.json` は識別子と表示名だけを持つ。ログインURL・ID・パスワード・認証方法は配布しない。
`portals.json` も空の状態で配布し、各利用者がGUIで設定する。候補外のサービス名も自由入力できる。

名称は2026-09-08に次の公式サイトの表記を確認した。リンクは名称確認の出典で、ログインURLの初期値ではない。

| 表示名 | 公式サイト |
|---|---|
| Goodfind | [Goodfind](https://www.goodfind.jp/) |
| 外資就活ドットコム | [外資就活ドットコム](https://gaishishukatsu.com/) |
| LabBase就職 | [LabBase就職](https://compass.labbase.jp/) |
| ビズリーチ・キャンパス | [ビズリーチ・キャンパス](https://br-campus.jp/) |
| リクナビ | [リクナビ](https://job.rikunabi.com/) |
| ワンキャリア | [ワンキャリア](https://www.onecareer.jp/) |
| OfferBox | [OfferBox](https://offerbox.jp/) |
| キミスカ | [キミスカ](https://kimisuka.com/) |
| dodaキャンパス | [dodaキャンパス](https://campus.doda.jp/) |
| Ｒｅ就活キャンパス | [学情のサービス紹介](https://service.gakujo.ne.jp/services/re_campus/) |

候補への掲載はサイト別アダプターの動作保証を意味しない。各サイトの認証方法・画面構造によっては、
汎用の欄検出が停止したり、ログイン状態が切れたりする。その場合は本人が専用Chromeでログインする。

## 端末内の保存先

| 保存先 | 内容 |
|---|---|
| `logs/local-login-settings.local.json` | 実行対象・時刻・有効／停止 |
| `logs/local-login-portals.local.json` | 本人が設定したサービス名・URL・認証方法 |
| `credential-store/<id>-<設定世代>.json` | Windows DPAPI CurrentUserで暗号化したログイン情報 |
| `logs/local-login-profiles/<id>-<設定世代>/` | サービスごとの専用Chromeプロファイル |
| `logs/local-login-YYYY-MM-DD.log` | 実行日時・サービス識別子・状態・理由・origin |
| `logs/activity-log.jsonl` | GUIで何を設定したかの記録。URL・認証情報は含めない |

いずれもgitignore対象。DB・snapshot・クラウドへ追加しない。認証情報やブラウザのセッションは端末間転送しない。
旧構成の `<id>.json` とプロファイルはそのまま読める。旧 `portals.json` がある端末では、ローカル設定を優先して読む。

GUIは保存有無と直近14ログファイル内の最後の結果を表示する。パスワードを読み戻す機能はない。
実行結果の「フォームを送信した」「ログイン画面がない」は、認証成功の確定とは区別して表示する。
MFA・CAPTCHA・セッション切れは本人対応として停止する。

## Windowsの実行予約

保存すると、現在のWindowsユーザーの `\katazuku-local-login` タスクへ反映する。
Windowsにログオンしていない間は実行しない。時刻にPCが停止していれば、次に実行可能になったときに処理する。
GUIを開いただけではタスクを作成・有効化しない。同じPCでは一つのインストール先から運用する。

保存に失敗したら設定と実行予約を復元し、古い画面からの上書きは拒否する。
日次ランナーも同じ設定を読み、各サービスの実行直前に有効状態を再確認する。既に開始したログインは中断しない。

登録済みサービスを手動で開くCLIもある。

```powershell
node scripts/local-login/daily-login.mjs --portal <サービスの識別子> --manual
```

`--manual` はremote debuggingなしの専用Chromeを開く。普段使いChromeのプロファイルは使わない。
設定は起動したPCだけに反映する。スマホやクラウドの管理画面では、この画面の起動方法を案内する。
macOS・Linuxの資格情報保存とスケジュール実行は未対応。

## APIと検証

設定サーバーは127.0.0.1だけで接続を受け、Host・Origin・起動ごとのトークンを検査する。
認証情報はローカルのPowerShellへ標準入力で渡し、コマンド引数・ブラウザ保存領域・クラウドへ送らない。
任意コマンド実行やパスワード読出しAPIは設けず、設定画面とAPIをキャッシュしない。

`node scripts/local-login/check-settings.mjs` で、合成データによる追加・変更・保存・停止・競合・HTTP境界・
認証情報分離を検証する。WindowsではDPAPIの往復と、合成タスクによる予約の作成・更新・復元も検証する。
試験で実タスクや実サイトは操作しない。
