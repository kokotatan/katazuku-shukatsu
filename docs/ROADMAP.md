# ロードマップと、最初に取り組みやすい課題

大きな方針は [../ROADMAP.md](../ROADMAP.md) にあります。ここには、いま手を付けられる具体的な課題を置きます。

## いまの到達点

- 正本DB(SQLite)・遷移規則・名寄せ・冪等な書き込み層
- 自動運転ワークフロー: メール見張り / 毎朝の選考同期 / きょうやること / 前夜ブリーフ / カレンダー同期 / 番犬
- AIプロバイダ: ChatGPT プラン(Sign in with ChatGPT)/ Claude Code / Codex / API キー / ローカルモデル
- 閲覧アプリ8本、5分デモ、Windows・macOS・Linux の定期実行

## 次の大きな山

1. **開発者でなくても使えるデスクトップアプリ**(無料・ローカル動作・オープンソース)。
   初回ウィザードで AI・Google・定期実行・アプリ起動までボタンで終わらせる。設計は [DESKTOP-APP.md](DESKTOP-APP.md)。
2. **ChatGPT プランでのツール利用**(関数呼び出し)。いまは文章生成だけの工程に限られるため、
   Gmail・カレンダーを katazuku 側の関数として渡し、メール見張りや朝のまとめも ChatGPT プランだけで回せるようにする。
3. **OS の資格情報ストア**(Windows Credential Manager / macOS Keychain / Linux Secret Service)。
4. **面談の議事録化**(録音 → 文字起こし → 要点・人物の抽出)。誤った議事録が正本へ入らない検証の設計から。

## good first issue 候補

初参加なら [最初の貢献ガイド](FIRST-CONTRIBUTION.md) を読んで、
募集中の [#36 Quickstart確認](https://github.com/kokotatan/katazuku-shukatsu/issues/36) または
[#37 日英の用語集](https://github.com/kokotatan/katazuku-shukatsu/issues/37) から選べます。
既存Issueに一言コメントし、作業範囲を相談してください。

以下の番号は候補の整理番号で、GitHubのIssue番号ではありません。未起票の候補は、実装前にIssueで範囲と完了条件を相談します。
目安は変更範囲の大きさです。データの公開範囲や認証に触れるものは、次節で別に扱います。

| # | 課題 | 触る場所 | 目安 |
|---|---|---|---|
| 1 | [#36](https://github.com/kokotatan/katazuku-shukatsu/issues/36): Quickstartとデモを macOS / Linux で試し、詰まった点を直す(PATH・ポート・初回インストールの案内) | `scripts/demo.mjs`, `docs/SETUP.md` | 小 |
| 2 | `npm run schedule:print -- launchd` / `-- systemd` の出力を実機で登録して確かめ、手順を docs に足す | `scripts/print-schedule.ts`, `docs/WORKFLOWS.md` | 小 |
| 4 | `scripts/db-appointment.ts conflicts` に `--pretty` を足し、空き判定の結果を人が読める表で出す | `scripts/db-appointment.ts`, テスト | 小 |
| 5 | `katazuku.config.json` を画面で作れるようにする(`examples/config-gui.html` を `schemas/katazuku-config.schema.json` に対応) | `examples/config-gui.html` | 中 |
| 8 | [#37](https://github.com/kokotatan/katazuku-shukatsu/issues/37): 就活用語の訳語表を作る。主要docsの英訳は別の小さな範囲で相談する | `README.md`, `docs/` | 小 |

## 設計相談が必要な候補

以下は上の初心者向け候補とは別です。実装前に、認証や閲覧範囲・公開してよい情報をIssueで確認します。

| 候補 | 触る場所 | 先に確認すること |
|---|---|---|
| 提出物台帳(`submission_requirement`)をスナップショットと `insight` に載せる | `scripts/snapshot.ts`, `shared/src/index.ts`, `insight/` | 閲覧範囲・個人データの露出・架空fixtureでの受け入れ条件 |
| ChatGPT プランのホストIDに JWK thumbprint 方式(RFC 9278)を追加する | `src/providers/chatgpt-siwc.ts`, テスト | 公式の認証手順・秘密値の扱い・既存UUID方式との互換性 |
| 番犬の結果を `impact` アプリで見られるようにする | `scripts/workflow.ts`, `scripts/snapshot.ts`, `impact/` | ログの個人情報を除外する形式。ログ全文をスナップショットへ載せない |

## 参加のしかた

- 始め方: [../CONTRIBUTING.md](../CONTRIBUTING.md)
- 実装前の相談: [Discussions](https://github.com/kokotatan/katazuku-shukatsu/discussions)
- 安全境界を変える提案は、コードを書く前に Issue か Discussion で脅威モデルを確認します。
