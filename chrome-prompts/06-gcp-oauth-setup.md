# 06 GCPコンソールでOAuthクライアント作成(google-workspace MCP用)

対象: docs/GOOGLE-MCP-SETUP.md ステップ1のブラウザ作業の代行。
事前に https://console.cloud.google.com/ を **careerアカウント** で開いておくこと。

---ここから貼り付け---

あなたは私のセットアップアシスタントです。今開いている Google Cloud コンソールで、Claude Code から Gmail・カレンダー・Drive・Sheets を使うための OAuth クライアントを作ってください。

前提チェック(最初に必ず):
- 画面右上のアカウントが okuyama.kotaro.career@gmail.com であること。違ったら何もせず報告して止まる

やってほしいこと(順番に):
1. 上部のプロジェクト選択で「katazuku」を選ぶ。無ければ「新しいプロジェクト」で名前 katazuku を作成し、作成完了後にそのプロジェクトへ切り替える
2. 「APIとサービス」→「ライブラリ」で次の4つを検索し、それぞれ「有効にする」を押す(すでに有効なら飛ばす):
   - Gmail API
   - Google Calendar API
   - Google Drive API
   - Google Sheets API
3. OAuth同意画面を設定する(メニュー名は「OAuth同意画面」または「Google Auth Platform」→「ブランディング」。UIの版で名称が違うので柔軟に):
   - User Type: 外部(External)
   - アプリ名: katazuku / サポートメール: okuyama.kotaro.career@gmail.com
   - 連絡先メール: okuyama.kotaro.career@gmail.com
   - スコープの追加は不要(スキップでよい)
   - テストユーザー(または「対象」→「テストユーザー」)に okuyama.kotaro.career@gmail.com を追加
4. 「認証情報」→「認証情報を作成」→「OAuthクライアントID」→ アプリケーションの種類は「デスクトップアプリ」、名前は katazuku-mcp で作成
5. 作成完了のダイアログに「クライアントID」と「クライアントシークレット」が表示されるので、**その画面を開いたままにして私に知らせる**(値は私が自分でコピーする)
6. 最後に、同意画面(「対象」ページ)の公開ステータスを確認し、「アプリを公開」ボタンがあれば押して本番に切り替える。確認ダイアログはそのままOKでよい(審査は不要)。エラーや審査要求が出たら無理に進めず、そのまま報告する

してはいけないこと:
- 課金(請求先アカウント)の設定・登録はしない。求められたら止まって報告する
- katazuku 以外のプロジェクトの設定を変えない
- クライアントシークレットをチャット欄に書き写さない(画面表示のままにする)

---ここまで---
