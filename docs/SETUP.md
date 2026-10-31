# セットアップ(自分のデータで使う)

ターミナル操作と、自分のGoogle Cloud OAuthクライアントの作成が必要です。
所要時間の目安は30〜60分に加え、初回の8画面の導入・ビルドです。Google Cloudの設定で時間が延びることがあります。
途中で詰まったら、[Issue の「セットアップで困った」](https://github.com/kokotatan/katazuku-shukatsu/issues/new/choose) で気軽に聞いてください。

まだなら、先に [認証なしのデモ](../README.md#デモで試す資格情報ゼロ) で画面を見ておくと、何ができるようになるかが分かります。

## 0. 必要なもの

- Node.js 22.13以降の22系、または24以降(推奨 24): <https://nodejs.org/>
- Git
- Google アカウント(就活用のもの)
- AIのどれか1つ: ChatGPT のプラン / Claude Code / Codex / API キー(→ [4. AIを選ぶ](#4-aiを選ぶ))

```sh
git clone https://github.com/kokotatan/katazuku-shukatsu.git
cd katazuku-shukatsu
npm ci
npm run doctor     # OS・Node・node:sqlite が使えるかの診断
```

## 1. 設定ファイルを作る

```sh
cp katazuku.config.example.json katazuku.config.json      # Windows(PowerShell)なら Copy-Item
```

`katazuku.config.json` を開いて、少なくとも次を自分の値にします(このファイルは gitignore 済みで、コミットされません)。

- `profile.displayName` — ブリーフでの呼び名
- `profile.signature` — 返信下書きの署名(1行ずつ)
- `google.accounts` — 就活用の Google アカウント。`primary: true` を1つだけ
- `agent.providerOrder` — 使うAIの順番(4で決める)

秘密値(API キーなど)は設定ファイルに書かず、`.env` に書きます(`.env.example` をコピー)。

## 2. 正本DBを作る

GoogleやAIを接続する前に、空の正本DBを一つだけ作ります。

```sh
npm run init
```

表示された絶対パスが、同期・MCP・閲覧・バックアップで共通の保存先です。
Windowsは利用者のLocalAppData、macOSはApplication Support、LinuxはXDGデータ領域に保存し、ソースツリーには置きません。
すでに正本がある場合は `KATAZUKU_DB` にその絶対パスを指定してから実行してください。既存データを初期化し直しません。
`npm run seed` は架空データの試験であり、この初期化の代わりにはなりません。

## 3. Google につなぐ(自分の OAuth クライアント)

共通接続を試す開発者向けに、Google Cloudプロジェクトを自分で作らない経路もあります。
`npm run google:workspace:connect -- --account 自分のメールアドレス` を使い、
[共通Google接続ガイド](GOOGLE-WORKSPACE.md)に従って本人が許可してください。
AI接続前に試す場合は `--no-sync` を付けて接続だけ確認してください。認証を完了するだけで初回同期が始まる経路もあるため、通常は手順4のAI接続を先に済ませます。
共通接続はGoogleの権限審査が未完了で、一般利用向けの完成版ではありません。
既存接続を自動で置き換えません。個別OAuthを使う場合は以下の手順を続けてください。

**あなた自身の Google Cloud プロジェクト**でOAuthクライアントを作り、`npm run google:connect` から本人がブラウザで読み取りを許可します。
メール下書き・予定の書込みを使う工程には、Google MCPの別接続も必要です。

1. <https://console.cloud.google.com/> で新しいプロジェクトを作る(名前は何でもよい)。
2. 「API とサービス」→「ライブラリ」で **Gmail API** と **Google Calendar API** を有効にする。
3. 「OAuth 同意画面」を作る。ユーザーの種類は「外部」、公開ステータスは「テスト」のままでよい。
   「テストユーザー」に自分の就活用アカウントを追加する(テスト中は追加した人しかログインできない=自分専用)。
4. 「認証情報」→「OAuth クライアント ID を作成」→ 種類は **デスクトップアプリ**。クライアントIDとシークレットを控える。
   これらは `.env`(`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`)にだけ書き、コミットしない。
5. `npm run google:connect` で就活用アカウントの読み取りを許可し、本人確認・Gmail・Calendarの診断が成功することを確認する。
   既存のMCP資格情報がある場合は上書きせず、`npm run google:connect -- --check` で確認する。
6. 下書き・予定の書込みを使う場合は [google-workspace MCP(workspace-mcp)](https://github.com/taylorwilsdon/google_workspace_mcp) を、
   [送信境界を検査する同梱bridge](GOOGLE-CONNECTION.md#3-workspace-mcpをcliへ登録する)経由で Claude Code / Codex に登録し、
   そのクライアントIDとシークレットを使って就活用アカウントで一度ログインする。workspace-mcpを直接登録しない。
   ログインすると `~/.google_workspace_mcp/credentials/<メールアドレス>.json` にトークンが保存され、
   katazuku の決定的な取得スクリプト(Gmail・カレンダーの読み取り)もそれを再利用します
   (置き場所を変えたら `google.credentialsDir` に書く)。

補足:
- テスト中の OAuth クライアントのトークンは、Google の仕様で一定期間ごとに再ログインが必要になることがあります。
  番犬(watchdog)が取得失敗を検知したら、使用している接続方式の再認証手順を確認してください。既存資格情報はCLIが自動で消去・上書きしません。
- 多くの人に配る「公開」クライアントにするには Google の審査(OAuth 検証)が必要です。自分用なら不要です。

確認:

読み取り専用CLI、MCPの具体的な登録コマンド、本人による認証と読み取り確認は [Google接続ガイド](GOOGLE-CONNECTION.md) を参照してください。
Google資格情報と選択したAIのローカル準備は、次の診断で確認できます（通信・ログインは行いません）。

```sh
npm run doctor -- --setup
```

```sh
npx tsx scripts/gmail-fetch.ts logs/check-mail.local.json --days 1     # 取得できた件数が出れば成功(読み取りのみ)
```

## 4. AIを選ぶ

いちばんかんたんなのは ChatGPT のプランです(ブラウザで許可するだけ)。全部の機能をAIに任せるなら、
ツールを使える Claude Code か Codex を1つ入れてください。詳しい比較は [AI-PROVIDERS.md](AI-PROVIDERS.md)。

```sh
npm run chatgpt -- signin      # ChatGPT プラン: ブラウザで「Continue with ChatGPT」→ 許可
claude                         # Claude Code: 本人がログイン(katazuku はログインを扱わない)
codex login                    # Codex: 本人がログイン
```

`katazuku.config.json` の例:

```json
{ "agent": { "providerOrder": ["claude-cli", "codex-cli", "chatgpt-siwc"] } }
```

## 5. 外に触れずに確認する

```sh
npm run workflow -- mail-watch --dry-run
npm run workflow -- daily-sync --dry-run
npm run workflow -- asa --dry-run
```

使うAIの順番・渡す能力・プロンプトが表示されます。ここで、アカウント一覧や署名が自分の値になっているかを確認します。
`--dry-run` は接続の成功を確認する機能ではありません。定期登録前に `npm run doctor -- --setup` と [Googleの読み取り確認](GOOGLE-CONNECTION.md) も済ませてください。

### 初回の朝まとめを本人宛に試験配信する

本人のprimary Googleアカウントを設定し、`notify.selfEmail`を`true`にしてから実行します。

```sh
npm run workflow -- asa --delivery-test first-setup --agent codex
```

「OSS初回導入・朝まとめ配信確認」と試験IDを件名に付け、本人宛に一通だけ送ります。
予定登録・下書き・既読化は行いません。同じ試験IDでの再実行は保存結果を使い、再送しません。
受信箱で件名と試験IDを確認してから定期登録へ進みます。途中失敗や成否不明のときは
Sentを照合し、新しいIDを発行してむやみに再送しないでください。
完了行のない実行は成功として再利用せず、`needs_resume`で停止します。
原因を直しても停止が続く場合は、実行プロセス終了と同じIDのSent・受信箱の未送信を確認してから、
`logs/agent-runs/asa-delivery-test-<試験ID>/`を監査用の別フォルダへ移動して保全し、同じIDで再開します。
送信の有無が不明な場合や一件でも見つかった場合は台帳を移動せず、再送せずに照合を続けます。
Googleの初回認証・自分のアカウント設定は本人が行う必要があります。

## 6. 毎日のワークフローを登録する

```sh
# Windows
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1

# macOS / Linux(出力を確認してから自分で貼る)
npm run schedule:print -- cron
```

登録後、次の朝に `logs/briefs/` に「きょうやること」ができていれば動いています。
ワークフローごとの時刻・中身・止め方は [WORKFLOWS.md](WORKFLOWS.md)。

## 7. アプリで見る

```sh
npm start
```

ホームと8画面を同じローカルURLから開けます。初回だけ全画面をビルドします。
ホームには `logs/briefs/` の朝・前夜それぞれの最新のまとめ、「今日やること」には応募とは別の未完了提出物を表示します。
`--db` で任意の別DBを指定した場合は、以前のDBのまとめと混ざらないようブリーフを表示しません。

起動時に既存の正本DBからスナップショットを更新します。ワークフローの実行時も更新されるので、画面の再読込で反映できます。
正本DBがまだない場合は案内だけを表示し、空のDBを作ったり、架空データへ切り替えたりしません。
日次同期が成功したことを確認してから再起動してください。

このPCの `127.0.0.1` にだけ公開します。LAN・スマホ・外部サーバーへの公開には使いません。
停止は Ctrl+C。ポートが使用中なら `npm start -- --port 4174`。起動だけで定期処理やAIは実行されません。

## 8. バックアップ

```sh
npm run backup    # 現在の正本DBを、整合性検査済みの1ファイルへ退避
npm run backup:verify -- "C:\absolute\path\to\backup.db"
```

復元は、稼働中の正本を上書きせず新しい絶対パスへ作ります。復元先を確認してから、設定の`KATAZUKU_DB`を自分で切り替えてください。

```powershell
npm run restore -- "C:\absolute\path\to\backup.db" "C:\absolute\new\katazuku-restored.db"
```

破損、参照切れ、未対応の未来版、既存の復元先、元と同じパスは拒否します。バックアップと復元はGoogle/Muse認可、資格情報、外部に保存した別バックアップを削除しません。

## やめるとき

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1 -Unregister
```

```sh
npm run chatgpt -- signout       # ChatGPT のセッションを失効させる
```

閲覧サーバーも Ctrl+C で停止します。正本DBは `npm run init` が表示した利用者別領域（または自分で指定した保存先）、作業ログは `logs/`、閲覧データは各画面の `public/snapshot.json` にあります。
利用を終える場合は、これらと個人設定・`.env`、接続時に作成された認証情報を自分で削除します。
バックアップを別の場所に保存した場合は、その場所も確認してください。
Google 側の許可は <https://myaccount.google.com/permissions> から取り消せます。
