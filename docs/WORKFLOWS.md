# 自動運転ワークフロー

katazuku の「毎日の就活ルーチン」を、あなたのPCの上で自動で回す部分です。
中身は Node のスクリプト(`scripts/workflow.ts`)と、エージェントへ渡すプロンプト(`scripts/*-prompt.md`)です。
エージェントの実体は、あなたが自分でログインした Claude Code / Codex などの CLI です(katazuku は資格情報を扱いません)。

```sh
npm run workflow -- <name> [--dry-run] [--agent auto|claude|codex|codex-oss]
```

`--dry-run` は外部に触れず、選ばれる provider の順番・渡す能力(capability)・プロンプトを表示するだけです。
ログの削除、番犬の状態保存、正本DBの自動マイグレーションは行いません。前夜ブリーフは既存DBを読取り専用で開きます。古いスキーマで読み取れない場合は試し実行も失敗し、DBを変更して直すことはしません。SQLiteのWAL形式では、読み取りのために補助ファイル(`-wal` / `-shm`)が作成される場合があります。
まずは全部 `--dry-run` で眺めてから登録してください。

## 前提

1. `katazuku.config.json` を作る(下の「設定」)。
2. Google: 自分の Google Cloud プロジェクトで OAuth クライアント(デスクトップアプリ)を作り、
   [google-workspace MCP(workspace-mcp)](https://github.com/taylorwilsdon/google_workspace_mcp) をその資格情報で
   Claude Code / Codex に登録して、対象アカウントで一度ログインする。保存されたトークンを決定的な取得スクリプトも再利用します。
3. AI: `claude`(Claude Code)か `codex`(Codex CLI)を入れて、あなた自身でログインしておく。

## 一覧

| 名前 | 既定の時刻 | 何をするか | AI | 外部への副作用 |
|---|---|---|---|---|
| `mail-watch` | 7:15〜22:15 毎時 | 未読を見張り、緊急なものだけ返信**下書き**・カレンダー登録・デスクトップ通知。提出物の前倒し準備 | 要 | 下書き・予定作成のみ(送信しない) |
| `daily-sync` | 毎朝 8:23 | Gmail を**決定的に取得** → 読み取り専用のエージェントが厳格JSONを抽出 → Schema と網羅性を検証 → 正本DBへ反映 → スナップショット | 要(抽出だけ) | なし(DB更新のみ) |
| `asa` | 毎朝 9:00 | 「きょうやること」最大3件。故障報告・未完了提出物・送り忘れの下書き・締切の作業ブロック(時刻入り)・DB予定のカレンダー反映 | 要 | 下書き・予定作成。`notify.selfEmail` のときだけ本人宛メール |
| `evening-brief` | 毎晩 20:15 | 明日の面接・面談の前夜ブリーフ(相手・前回の記録・想定問答)。予定が無い日はAIを呼ばない | 予定がある日だけ | `notify.selfEmail` のときだけ本人宛メール |
| `calendar-sync` | 30分ごと | Google Calendar → 正本DB(**LLMなし**)。企業を特定できない予定だけAIへ回す。空き判定用に私用予定も投影 | 要判定があるときだけ | なし(DB更新のみ) |
| `watchdog` | 4時間ごと | 各ワークフローが止まっていないか、providerが全滅していないかの番犬(**LLMなし**) | 不要 | なし |
| `inbox-tidy` | daily-sync の後(既定は無効) | 古い未読を既読化するだけ(削除しない)。面談調整・事前準備系は未読のまま残す | 要 | ラベル変更のみ |

「AI」列の要は、`katazuku.config.json` の `agent.providerOrder` の順に試します。
使える provider と、あなた自身のAIサブスクリプションで動かす方法は README の「AIプロバイダ」を参照してください。

## 安全境界(コードで強制しているもの)

- 無人のワークフローには**第三者へ送信する能力を渡しません**。返信は常に下書きです。
  本人宛の通知メールは `gmail.send.self` という別能力で、`notify.selfEmail: true` のときだけ渡します。
- フォーム送信・予約確定・提出・辞退は、どの工程でも実行しません。提出物は「本人の最終承認待ち(ready_for_approval)」までです。
- daily-sync では、モデルにDB書き込みやSQLを任せません。抽出結果は JSON Schema と
  「全メールIDを読んだか」の網羅性で検証してから、既存の書き込み層(`transition()` の遷移規則・冪等キー)で反映します。
  1日に15社を超える選考変更は暴走とみなして止めます(`--force` で解除)。
- provider の切り替えは「副作用を始める前の失敗」(未ログイン・利用枠切れ・接続失敗)のときだけです。
  途中まで外部操作をした可能性がある失敗は、別 provider でやり直さず `needs_resume` で止まります。
- ローカルモデル(`codex-oss`)は `agent.localModelWorkflows` に載せたワークフローだけに使います(既定は読み物系だけ)。
- claude.ai 側のコネクタは読み込ませません(`ENABLE_CLAUDEAI_MCP_SERVERS=false`)。Google は google-workspace MCP だけを使います。

## 完了判定と故障の知らせ方

- 各プロンプトは最後に `=== <name> DONE ===` の単独行を出す約束です。終了コード0や出力の長さでは成功とみなしません
  (プロンプトが渡らず対話応答だけ返して正常終了した、という失敗を見逃さないため)。
- 失敗は `logs/alert-<name>.txt` に自分専用で残ります。番犬がそれらを集め、翌朝の `asa` が【自動化の故障】として報告します。
- 何を・何のために・どうしたかは `logs/activity-log.jsonl` に1行ずつ残ります。
- 同じワークフローの二重起動はロックで防ぎ、固まったプロセスはツリーごと止めます(孫のMCPサーバまで)。

## 設定(`katazuku.config.json`)

雛形をコピーして使います。個人の値はこのファイルにだけ書き、コードやプロンプトには書きません(gitignore 済み)。

```sh
cp katazuku.config.example.json katazuku.config.json
```

| キー | 意味 |
|---|---|
| `profile.displayName` / `signature` | ブリーフでの呼び名、返信下書きの署名(1行ずつ) |
| `profile.interviewReminders` | 前夜ブリーフの末尾に毎回そのまま載せる、自分で決めた心構え(任意) |
| `google.accounts[]` | 対象の Google アカウント。`primary: true` を1つだけ(就活予定を登録する先)。`calendars` は `all-visible` か `primary` |
| `google.credentialsDir` | 保存済み OAuth トークンの置き場(既定は google-workspace MCP と同じ場所) |
| `agent.providerOrder` | 試す順番。`claude-cli` / `codex-cli` / `codex-oss` など |
| `agent.localModelWorkflows` | ローカルモデルに任せてよいワークフロー |
| `notify.selfEmail` / `desktop` | 朝のまとめ・前夜ブリーフを本人宛メールでも届けるか / デスクトップ通知を出すか |
| `mail.searchTerms` / `promoSenderDomains` | 日次同期で拾う語 / 宣伝扱いにする送信元ドメイン |
| `workflows.<name>.enabled` | ワークフローごとのON/OFF |

形式は `schemas/katazuku-config.schema.json` で検証します(未知のキーはエラー)。

## 定期実行の登録

### Windows(タスクスケジューラ)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1
schtasks /run /tn katazuku-watchdog      # 1本だけ試す
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\register-tasks.ps1 -Unregister
```

タスクは「ログオン中だけ」動きます(あなた自身の Claude Code / Codex のログインを使うため)。
スリープ中に逃した実行は復帰後に1回だけ走ります。

### macOS / Linux

```sh
npm run schedule:print -- cron       # crontab -e に貼る行
npm run schedule:print -- launchd    # macOS: ~/Library/LaunchAgents に置く plist
npm run schedule:print -- systemd    # Linux: ~/.config/systemd/user に置く service / timer
```

出力を確認してから、自分で貼り付けてください(katazuku はスケジューラへ勝手に書き込みません)。
cron は PATH が最小になるので、`claude` / `codex` が見つからない場合は `.env` に
`KATAZUKU_CLAUDE_COMMAND` / `KATAZUKU_CODEX_COMMAND` を書きます(`.env.example` 参照)。

## 部品(手で叩けるもの)

| コマンド | 役割 |
|---|---|
| `npx tsx scripts/gmail-fetch.ts out.json --days 3` | Gmail を読み取り専用で取得(LLMなし) |
| `npx tsx scripts/calendar-fetch.ts out.json` | カレンダーを取得・正規化(LLMなし) |
| `npx tsx scripts/submission-readiness.ts list` | 未完了提出物の再評価 |
| `npx tsx scripts/db-appointment.ts conflicts <開始> <終了>` | 空き判定(`available` / `conflict` / `unknown`)。情報不足は `unknown` で、空きとは扱わない |
| `npx tsx scripts/brief-data.ts [YYYY-MM-DD]` | 前夜ブリーフの材料 |
| `npx tsx scripts/db-calendar-outbox.ts` / `db-link-calendar.ts` | DB → カレンダーの送信待ちと、作成済みIDの書き戻し |

## 未移植のもの

面談の録音から議事録を作る `interview-digest`(文字起こし・話者推定・人物抽出)は、まだ入っていません。
録音そのものは [MEETING-RECORDING.md](./MEETING-RECORDING.md) の手順で使えます。
