就活メールから選考管理シートへの毎日同期を実行してください。

手順:

1. `pipeline/service-account.json` の存在を確認。無ければ「サービスアカウント鍵がありません。docs/MINIPC-SETUP.md の手順4を参照」とだけ出力して終了。
2. Gmail MCP (mcp__claude_ai_Gmail__search_threads / get_thread) で直近1日(`newer_than:1d`)の就活関連メールを検索する。Gmail MCPツールが利用できない環境なら「Gmail MCP が使えないため同期をスキップ」と出力して終了。
3. メールから企業ごとに以下を抽出する:
   - 選考ステータス: 出願済 / 合格 / 不合格 / 辞退 など → stage にマッピング(出願予定=scouted, 出願済=entried, ES・テスト中=task, 面接中=interview, インターン合格=intern, 内定=offer, 不合格・辞退=closed)
   - 〆切・選考日(面接日程を含む) → nextDate (YYYY-MM-DD)
   - 次にやること → nextAction
   - 業界が分かれば industry
4. 抽出結果を `{name, stage, nextAction, nextDate, industry}` の配列JSONとして `pipeline/sheet-import-loop.json` に書き出す(gitignore済み)。対象メールが無ければ「新しい選考情報はありませんでした」と出力して終了。
5. `cd pipeline; npx tsx scripts/sheet-sync.ts sheet-import-loop.json` で dry-run 実行し、差分を確認する。
6. 差分が妥当(既存の合格/不合格を壊さない・件数が異常に多くない)なら `--apply` を付けて書き込む。妥当でなければ書き込まず理由を出力する。
7. Inboxアプリ用の取込データを更新: 手順2で取得済みのメール(直近1日分)を RawEmail 形式
   `{id: "gmail-<msgId>", from, fromAddress, subject, body, receivedAt}` の配列として
   `inbox/gmail-import-daily.json` に上書きWriteする(gitignore済み)。
   ※ from は本文署名から企業名を推定して入れる。アプリ側がIDで重複排除するので過去分と重なってよい。
8. 受信トレイの整理(katazuku Inboxが受信箱、Gmailはフラット化する運用):
   - 就活サービス媒体(slogan.jp / br-campus.jp / typeshukatsu.jp / en-courage.com / labbase.jp / openwork.jp / gaishishukatsu.com / gakujo.ne.jp / ibeck.co.jp / offerbox.jp / mynavi.jp / rikunabi.com)の `is:unread older_than:7d` は label_thread で TRASH へ
   - それ以外の `is:unread older_than:1d` は unlabel_thread で UNREAD を外す(既読化・削除はしない)。手順7でアプリに取り込み済みなので見逃しは起きない
   - 当日(1日以内)の未読はそのまま残す(緊急対応の目印のため)
9. 最後に結果サマリ(更新した企業名・選考日・追記件数・既読化/ゴミ箱の件数)を簡潔に出力する。

注意: シートの書き込みルール(合格/不合格/辞退は上書きしない、メモ・数式列に触れない)はスクリプト側で保証されているが、dry-run の差分は必ず目視確認すること。
