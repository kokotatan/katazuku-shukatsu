# Claude / Codex 自動引継ぎ

## 動作

共通runnerを使う処理は、既定で `Claude -> Codex -> Codex経由のローカルOSS` の順に実行する。

Claudeが利用枠切れで終了した場合は次のように扱う。

1. `weekly limit`、`usage limit`、`quota exceeded`等を `quota_exhausted` として検知する
2. CLI出力に `resets Jul 26, 9pm (Asia/Tokyo)`形式の復活日時があればUTCへ変換する
3. `logs/agent-runs/provider-health.local.json`へ利用不能期限を保存する
4. 同じ実行を継続可能なモードならCodexへ切り替える
5. 期限まではClaudeを起動せずCodexを使う
6. 期限後の次のタスクでClaudeを再度先に試し、成功したら制限状態を消す

実行中のCodexはClaudeの復活時刻に強制停止しない。現在の作業単位を終え、次のタスク境界でClaudeへ戻す。

## 開発タスク

依頼と完了条件をMarkdownへ書き、次を実行する。

~~~powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/run-agent-task.ps1 `
  -TaskFile tasks/my-task.md
~~~

`run-agent-task.ps1`は `workspace` モードを使う。Claudeが途中で終了した場合、Codexには同じ依頼に加えて
次の継続指示を渡す。

- 作業ツリーと差分を先に確認する
- ユーザーと前providerの変更を保持する
- 最初から繰り返さず未完了部分を続行する
- 元の完了条件とテストまで仕上げる

タスクファイルの内容hashから安定したrun IDを作る。結果と試行ログはgitignore済みの`logs/`へ保存し、
prompt本文や秘密情報をrun台帳へ保存しない。

Web検索が不要なら`-NoWeb`、providerを固定して診断する場合だけ`-Agent claude`または`-Agent codex`を指定する。

## 引継ぎモード

| 処理 | 自動切替 |
|---|---|
| 読取・抽出・厳格JSON生成 | 可 |
| 同じworkspace内のコード・文書編集 | 可。差分を確認して続行 |
| 決定論executor開始前のDB入力 | 可 |
| Gmail・Calendar・Drive・DBを再取得できる運用処理 | 可。履歴・外部ID・sourceRef・runIdを照合し、完了済み操作を飛ばして続行 |
| 再照合方法を持たない外部操作 | 不可。`needs_resume`で停止 |
| MFA、CAPTCHA、本人承認、Web適性検査 | 不可。本人へ引継ぎ |

Codex側に必要なMCP・connectorがない処理は候補から外れる。`.codex/config.toml`に
`[mcp_servers.google-workspace]`がある端末ではGmail・Calendar・Drive・Sheets capabilityを自動検出する。
`daily-sync`、`mail-watch`、`asa`、`calendar-sync`、`reconcile-calendar`、`open-meeting-urls`、
`katazuku`の手動コマンドも共通runnerへ移行済みで、外部操作は`reconcile`モードで現在状態を再読して継続する。
`interview-digest`はVoicebox MCPを実行時にCodexへ接続し、同じ作業ツリー上の文字起こし・議事録を続行する。

## 診断

通常ユーザーのPowerShellで次を実行する。

~~~powershell
npm --prefix sync run agent:doctor
Get-Content logs/agent-runs/provider-health.local.json
~~~

`provider-health.local.json`を手で編集する必要はない。復活時刻後の成功で自動的に解除される。
