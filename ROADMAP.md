# Roadmap

katazuku-shukatsu は、完成品を一括公開するのではなく、安全境界を保てる小さな単位で育てます。
実際の就活データ、認証情報、企業ごとの提出履歴は公開しません。

## 現在地: v0.3

- ローカルSQLite正本、状態遷移、名寄せ、冪等な書き込み層
- 応募run、本人承認ゲート、Web適性検査を代理しない安全境界
- カレンダー予定と移動可能性の判定
- provider非依存のエージェント実行契約
- 宣言的workflow、正本identity、承認hash、checkpoint、外部状態reconcile
- Gmail / Calendar接続と、アカウント不要のICS / CSV / JSON入力
- Windows DPAPI CurrentUserと隔離Chromeを使うローカル認証ブローカー
- `BrowserDriver` interface、秘密値を含まないdry-run、外部確定前の承認・冪等・再照合契約
- 応募企業と就活支援組織を混同しないデータモデル
- 読み取り専用アプリ8本
- 任意のCloudflare Worker + R2セルフホスト

## 次に作るもの

### production外部実証

- Muse Connectorのproduction提出・審査・利用者接続
- Google共通接続の権限審査
- 利用規約を確認した採用portalごとの`BrowserDriver` adapterと実サイト回帰
- macOS Keychain / Linux Secret Service adapterと実機検証

共通のブラウザ操作計画は[安全契約](docs/BROWSER-PLAN.md)と合成fixtureまで実装済みです。
実サイトadapterは、利用規約、画面変更時の停止、commit後の成功証拠を確認できた接続先だけ追加します。
実在アカウント、Cookie、HTML、選考問題はfixtureへ持ち込みません。

### 利用者向けの完成度

- 設定ウィザード、データ削除CLI（検証済みバックアップと新規パス復元は実装済み）
- 非開発者向けデスクトップアプリの初回接続と更新
- 日本語・英語ドキュメントと導入事例

## 参加してほしいところ

すぐ手を付けられる具体的な課題は [docs/ROADMAP.md](docs/ROADMAP.md#good-first-issue-候補) にまとめています。

初めての貢献では、[`good first issue`](https://github.com/kokotatan/katazuku-shukatsu/labels/good%20first%20issue)を見てください。
実装前の相談は[Discussions](https://github.com/kokotatan/katazuku-shukatsu/discussions)、具体的な作業は
[`help wanted`](https://github.com/kokotatan/katazuku-shukatsu/labels/help%20wanted)で扱います。

- 就活経験者: 用語、導線、失敗時の分かりにくさをレビューする
- TypeScript / SQLite: migration、状態機械、テストを改善する
- macOS / Linux: OS資格情報ストアadapterを作る
- ブラウザ自動化: 共通契約を弱めず、規約確認済みサイトadapterと合成fixtureを作る
- ドキュメント: quickstartを試し、詰まった点を修正する

安全境界を変える提案は、コードを書く前にIssueまたはDiscussionで脅威モデルを確認します。
