# Roadmap

katazuku-shukatsu は、完成品を一括公開するのではなく、安全境界を保てる小さな単位で育てます。
実際の就活データ、認証情報、企業ごとの提出履歴は公開しません。

## 現在地: v0.3

- ローカルSQLite正本、状態遷移、名寄せ、冪等な書き込み層
- 応募run、本人承認ゲート、Web適性検査を代理しない安全境界
- カレンダー予定と移動可能性の判定
- provider非依存のエージェント実行契約
- 応募企業と就活支援組織を混同しないデータモデル
- 読み取り専用アプリ8本
- 任意のCloudflare Worker + R2セルフホスト

## 次に作るもの

### v0.4: ブラウザと資格情報の安全な境界

- `BrowserDriver` interfaceとdry-run可能な操作計画
- `SecretStore` interface。モデルへパスワード文字列を渡さず、参照IDで扱う
- Windows DPAPI、macOS Keychain、Linux Secret Serviceのadapter
- CAPTCHA、MFA、本人確認へ到達したら停止して本人へ引き渡すcheckpoint
- 送信・予約・辞退の直前に、表示内容と承認hashを再検証するexecutor

企業サイト固有の自動操作を先に増やさず、まず共通境界と合成fixtureを固定します。
実在アカウント、Cookie、HTML、選考問題はfixtureへ持ち込みません。

### v0.5: 入力connectorと再開可能なworkflow

- Gmail / Calendarのadapter interface
- ICS / CSV / JSONによる、アカウント接続不要のimport
- workflow schema、checkpoint、failure分類、監査ログ閲覧
- 同じ外部操作を二重実行しないreconcile

### その後

- opt-inのフォーム入力支援
- 利用規約と安全性を確認できたサイトadapter
- 設定ウィザード、バックアップ復元、データ削除CLI
- 日本語・英語ドキュメントと導入事例

## 参加してほしいところ

初めての貢献では、[`good first issue`](https://github.com/kokotatan/katazuku-shukatsu/labels/good%20first%20issue)を見てください。
実装前の相談は[Discussions](https://github.com/kokotatan/katazuku-shukatsu/discussions)、具体的な作業は
[`help wanted`](https://github.com/kokotatan/katazuku-shukatsu/labels/help%20wanted)で扱います。

- 就活経験者: 用語、導線、失敗時の分かりにくさをレビューする
- TypeScript / SQLite: migration、状態機械、テストを改善する
- Windows / macOS / Linux: OS資格情報ストアadapterを作る
- ブラウザ自動化: 停止境界、dry-run、合成fixtureを設計する
- ドキュメント: quickstartを試し、詰まった点を修正する

安全境界を変える提案は、コードを書く前にIssueまたはDiscussionで脅威モデルを確認します。
