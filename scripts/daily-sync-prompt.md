就活メールから選考管理シートへの毎日同期を実行してください。

**最優先の方針: 全工程を止めない。** サービスアカウント鍵(`status/service-account.json`)が無くても、鍵が要らない工程(メール取得・分類・締切/日程抽出・Inbox取込・受信トレイ整理)は必ず実行する。鍵が必要なのは**選考シートへの書き込み(手順5〜6)だけ**で、そこだけを条件付きにする。鍵が無いことを理由に全体を早期終了してはならない。

手順:

1. `status/service-account.json` の存在を確認し、結果(鍵あり/鍵なし)を覚えておく。**無くても終了せず次の手順へ進む**。最後のサマリに鍵の有無を明記する。
2. Gmail MCP で直近1日(`newer_than:1d`)の就活関連メールを検索する。Gmail MCP ツールは環境により
   mcp__google-workspace__ 系(search_gmail_messages / get_gmail_thread_content)または
   mcp__claude_ai_Gmail__ 系(search_threads / get_thread / get_message)のどちらかが使えるので、使える方を使う
   (以降の手順でツール名を挙げている箇所も同様に読み替える)。**どちらも利用できない環境のときだけ**
   「Gmail MCP が使えないため中止」と出力して終了する(この場合は最後の完了行を出さない)。
3. メールから企業ごとに以下を抽出する:
   - 選考ステータス: 出願済 / 合格 / 不合格 / 辞退 など → stage にマッピング(出願予定=scouted, 出願済=entried, ES・テスト中=task, 面接中=interview, インターン合格=intern, 内定=offer, 不合格・辞退=closed)
   - 〆切・選考日(面接日程を含む) → nextDate (YYYY-MM-DD)
   - 次にやること → nextAction
   - 業界が分かれば industry
4. 抽出結果を `{name, stage, nextAction, nextDate, industry}` の配列JSONとして `status/sheet-import-loop.json` に書き出す(gitignore済み)。対象メールが無ければ空配列でよい。
5. **`status/service-account.json` が存在する場合のみ**: `cd status; npx tsx scripts/sheet-sync.ts sheet-import-loop.json` で dry-run 実行し、差分を確認する。
   **存在しない場合**は「サービスアカウント鍵が無いためシート同期のみスキップ(他工程は継続)」と記録し、手順7へ進む(これは正常動作であり故障ではない)。
6. (鍵ありのとき)差分が妥当(既存の合格/不合格を壊さない・件数が異常に多くない)なら `--apply` を付けて書き込む。妥当でなければ書き込まず理由を出力する。
7. Inboxアプリ用の取込データを更新: 手順2で取得済みのメール(直近1日分)を RawEmail 形式
   `{id: "gmail-<msgId>", from, fromAddress, subject, body, receivedAt}` の配列として
   `inbox/gmail-import-daily.json` に上書きWriteする(gitignore済み)。対象メールが無ければ空配列でよい。
   ※ from は本文署名から企業名を推定して入れる。アプリ側がIDで重複排除するので過去分と重なってよい。
8. 受信トレイの整理(katazuku Inboxが受信箱、Gmailはフラット化する運用):
   - 就活サービス媒体(slogan.jp / br-campus.jp / typeshukatsu.jp / en-courage.com / labbase.jp / openwork.jp / gaishishukatsu.com / gakujo.ne.jp / ibeck.co.jp / offerbox.jp / mynavi.jp / rikunabi.com)の `is:unread older_than:7d` は batch_modify_gmail_message_labels(claude_ai 系なら label_thread / label_message)で TRASH ラベルを付けてゴミ箱へ
   - それ以外の `is:unread older_than:1d` は batch_modify_gmail_message_labels(claude_ai 系なら unlabel_thread / unlabel_message)で UNREAD ラベルを外す(既読化のみ・削除はしない)。手順7でアプリに取り込み済みなので見逃しは起きない
   - 当日(1日以内)の未読はそのまま残す(緊急対応の目印のため)
   - **最重要の例外**: 件名・本文に「人事面談・面談調整・Slack招待/ワークスペース・インターン事前準備(事前アンケート/セットアップ/持ち物/宿泊/交通費/キックオフ)」が含まれ、かつ未対応に見えるメールは**既読化せず未読のまま残し**、サマリの冒頭で個別に報告する。この種の見逃しは選考辞退扱いに直結するため最優先
9. 最後に結果サマリ(鍵の有無・シート同期の実行可否・更新した企業名・選考日・追記件数・既読化/ゴミ箱の件数)を簡潔に出力する。
   **サマリの最終行に、他の文字を付けず単独で `=== daily-sync 完了 ===` と必ず出力する**(この行の有無で正常完了を判定するため。全工程を実行できたときのみ出力し、鍵不在による手順5〜6のスキップは正常完了に含める)。

注意: シートの書き込みルール(合格/不合格/辞退は上書きしない、メモ・数式列に触れない)はスクリプト側で保証されているが、dry-run の差分は必ず目視確認すること。
