# Windowsローカル認証ブローカーと自動ログイン

Windows DPAPI CurrentUser、隔離Chromeプロファイル、originとテナントパスの再検査を使い、
モデルやkatazuku本体へID・パスワードを渡さずログインフォームへ入力します。外部送信、応募、
エントリー、予約、規約同意は行いません。MFA、CAPTCHA、曖昧な欄、origin変更では復号前に停止します。

## 安全境界

- 資格情報は`credential-store/`のDPAPI暗号文だけ。Git、DB、snapshot、MCP、ログへ入れません。
- サービス設定は`logs/local-login-portals.local.json`、実行設定は`logs/local-login-settings.local.json`へ置きます。
- Chromeは`logs/local-login-profiles/`のサービス・設定世代別プロファイルを使い、普段使いのChromeへ接続しません。
- 共有ATSはoriginだけでなくログインURLのテナントパスまで固定します。
- URLや認証方式を変更すると新しい設定世代になり、古い資格情報とセッションを再利用しません。
- 「規約に同意してログイン」など追加の意思表示を含む操作は自動実行しません。

## 1. サービスを端末内へ登録

```powershell
npm run local-login:configure -- --id example-portal --label "利用するサービス" --login-url "https://login.example.test/team/start" --auth-mode password
```

SSOで本人が専用Chromeへログインする場合は`--auth-mode sso`を使います。既存設定のURLまたは認証方式を
変更するときだけ`--replace`を付けます。クエリ、fragment、URL内認証情報、HTTP外部URLは拒否されます。

## 2. ID・パスワード方式だけ資格情報を登録

```powershell
npm run local-login:credential -- --portal example-portal
```

Windowsのプロンプトへ本人が入力します。秘密値はコマンド引数、環境変数、Node.js、標準出力へ渡りません。
通常のApple/Google等のアカウントパスワードを別用途へ転用せず、サービスが発行する専用資格情報を使います。

## 3. 合成試験と手動確認

```powershell
npm run test:local-login
npm run local-login:run -- --portal example-portal --headful
```

SSOの初回本人認証は`--manual`を使います。MFA、パスキー、ワンタイムコード、CAPTCHAは本人が処理し、
ブローカーへ渡しません。`submitted`はフォームを送った事実であり、ログイン成功の断定ではありません。

## 4. Windows定期実行

```powershell
npm run local-login:schedule -- --enable --at 07:40 --portal example-portal
```

複数サービスは`--portal`を繰り返します。停止時は次を実行します。

```powershell
npm run local-login:schedule -- --disable --at 07:40
```

設定保存とWindowsタスク更新は一体で扱い、タスク更新に失敗した場合は設定を元へ戻します。
実行結果は`logs/local-login-YYYY-MM-DD.log`へ、時刻・サービスID・status・reason・originだけを残します。

## 対応範囲

現在の実装はWindowsとGoogle Chromeに対応します。macOS Keychain、Linux Secret Service、普段使いChromeへの
Native Messaging接続は未実装です。公開presetは表示名だけで、実URL、資格情報、Cookie、プロファイルを含みません。
