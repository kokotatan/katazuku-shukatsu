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

どれも1〜数日で終わる大きさで、安全境界に触れません。取り組むときは Issue を立てて一言書いてください。

| # | 課題 | 触る場所 | 目安 |
|---|---|---|---|
| 1 | `npm run demo` を macOS / Linux で試し、詰まった点を直す(PATH・ポート・初回インストールの案内) | `scripts/demo.mjs`, `docs/SETUP.md` | 小 |
| 2 | `npm run schedule:print -- launchd` / `-- systemd` の出力を実機で登録して確かめ、手順を docs に足す | `scripts/print-schedule.ts`, `docs/WORKFLOWS.md` | 小 |
| 3 | 提出物台帳(`submission_requirement`)をスナップショットに載せ、`insight` アプリに「未完了提出物」欄を出す | `scripts/snapshot.ts`, `shared/src/index.ts`, `insight/` | 中 |
| 4 | `scripts/db-appointment.ts conflicts` に `--pretty` を足し、空き判定の結果を人が読める表で出す | `scripts/db-appointment.ts`, テスト | 小 |
| 5 | `katazuku.config.json` を画面で作れるようにする(`examples/config-gui.html` を `schemas/katazuku-config.schema.json` に対応) | `examples/config-gui.html` | 中 |
| 6 | ChatGPT プランのホストIDを、推奨の JWK thumbprint 方式(RFC 9278)でも作れるようにする(既存の UUID 方式は残す) | `src/providers/chatgpt-siwc.ts`, テスト | 中 |
| 7 | 番犬の結果をアプリで見られるようにする(`logs/watchdog-summary.local.txt` をスナップショットへ。個人情報は載せない) | `scripts/workflow.ts`, `scripts/snapshot.ts`, `impact/` | 中 |
| 8 | README の English セクションと主要な docs の英訳を整える(就活用語の訳語表を作る) | `README.md`, `docs/` | 小 |

## 参加のしかた

- 始め方: [../CONTRIBUTING.md](../CONTRIBUTING.md)
- 実装前の相談: [Discussions](https://github.com/kokotatan/katazuku-shukatsu/discussions)
- 安全境界を変える提案は、コードを書く前に Issue か Discussion で脅威モデルを確認します。
