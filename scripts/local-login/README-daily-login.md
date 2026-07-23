# 毎日ログイン(LabBase / 外資就活ドットコム)

継続ログインで大手からの優遇オファーを狙うため、2ポータルへ毎日1回だけ自動でログインを試みる足場。
秘密値の入力は資格情報ブローカー(broker.mjs / lib.mjs, spec13)が別プロセスで担い、
ランナー・スケジューラ・本READMEの手順のいずれもパスワードを見ない・保存しない。

対象ポータル(`portals.json`):

| portal_id | ポータル | ログインURL | allowed_origin |
| --- | --- | --- | --- |
| `labbase` | LabBase(理系スカウト就活) | https://compass.labbase.jp/login | `https://compass.labbase.jp` |
| `gaishishukatsu` | 外資就活ドットコム | https://gaishishukatsu.com/login | `https://gaishishukatsu.com` |

## 前提

- Node(リポジトリの `engines`: node 24 系)と Google Chrome がインストール済みであること。
- 対象は「専用の隔離Chromeプロファイル」(`logs/local-login-profiles/<portal>`、gitignore配下)。
  普段使いのChromeには接続しない(spec13の境界)。

## 有効化手順

### 1. 資格情報を登録する(本人が手動で1回だけ)

パスワードは SecureString で本人が入力する。エージェントは値に一切触れない。

```powershell
# LabBase
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-login\store-credential.ps1 `
  -PortalId labbase -AllowedOrigin https://compass.labbase.jp -OutputPath credential-store\labbase.json

# 外資就活ドットコム
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\local-login\store-credential.ps1 `
  -PortalId gaishishukatsu -AllowedOrigin https://gaishishukatsu.com -OutputPath credential-store\gaishishukatsu.json
```

アカウントはいずれも `okuyama.kotaro.career@gmail.com`。`credential-store\` はDPAPI暗号化済みでも機密扱いでgitignore。

### 2. 初回だけ画面ありでログインする(MFA/CAPTCHAを通す)

隔離プロファイルにセッションを作る。初回はMFAやCAPTCHAが出やすいので画面ありで実行し、必要なら本人が対応する。

```powershell
node scripts\local-login\daily-login.mjs --portal labbase --headful
node scripts\local-login\daily-login.mjs --portal gaishishukatsu --headful
```

ブローカーが原因(`credential_fields_not_unique` 等)で止まった場合は、
本人がその場でIDとパスワードを入力してログインするだけでよい(セッションはプロファイルに残る)。

### 3. スケジューラに登録する(1回)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-local-login.ps1
```

毎朝7:40に隠しウィンドウ(`run-local-login.vbs`)で `daily-login.ps1` が走り、
`credential-store\` にレコードのある全ポータルへ headless でログインを試みる。
PCが寝ていれば次に使える時点で実行(StartWhenAvailable)。解除は
`Unregister-ScheduledTask -TaskName 'katazuku-local-login' -Confirm:$false`。

## 毎日の挙動

1. ポータルごとに専用プロファイルの Chrome を loopback限定の remote-debugging で起動しログインURLを開く。
2. 既にログイン済み(フォーム無し)なら `no_login_form` として完了。セッションを温めるだけで終わる。
3. フォームがあればブローカーが origin と欄type を再検証し、DPAPI復号→入力→送信を自プロセスで完結。
4. MFA/CAPTCHA/origin不一致/欄が一意でない等は入力せず停止し、理由を記録する。

## ログ

`logs/local-login-YYYY-MM-DD.log`(gitignore)に1行JSONで残る。記録するのは
`ts` / `status` / `reason` / `portalId` / `origin` のみ。ID・パスワードは残さない。

status の意味:

| status | 意味 |
| --- | --- |
| `submitted` | ログインフォームに入力し送信した |
| `no_login_form` | フォームが無い(概ねログイン済み。セッション有効) |
| `stopped` | 入力せず停止(reason: `mfa` / `captcha` / `credential_fields_not_unique` 等) |
| `skipped` | 資格情報レコードが未登録(reason: `no_credential_record`) |
| `error` | 起動失敗・origin不一致等(reason参照) |

## 既知の残課題

- 実サイトの欄検出: spec13の検証どおり、`<label for>` を使わずth/div近傍テキストで欄名を示すサイトは
  現行ヒューリスティックが `credential_fields_not_unique` で止まりうる。外資就活はSSRで
  `type=email`+`type=password`+`type=submit` の素直な構成、LabBaseはSPA(描画待ちあり)。
  止まった場合の当面の運用は手順2の手動ログイン。恒久対応は spec13「残作業1(欄特定の決定規則拡張)」。
- 普段使いChrome連携(拡張+Native Messaging境界)は未実装。本足場は隔離プロファイル限定。
