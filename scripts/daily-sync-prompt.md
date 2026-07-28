就活メールから正本DB(ローカルSQLite)への毎日同期と、シートへのミラーを実行してください。

**構造(2026-07-18 DB中心化)**: 正本は `data/katazuku.db`。シート(選考管理/企業マスタ)は見るだけの窓で、
DB→シートの一方向ミラー。書き手はagentのみ。サービスアカウント鍵は不要(DBはローカル・シートはMCPで書く)。

手順:

1. Gmail MCP で直近1日(`newer_than:1d`)の就活関連メールを検索する。Gmail MCP ツールは環境により
   mcp__google-workspace__ 系(search_gmail_messages / get_gmail_thread_content)または
   mcp__claude_ai_Gmail__ 系(search_threads / get_thread / get_message)のどちらかが使えるので、使える方を使う
   (以降の手順でツール名を挙げている箇所も同様に読み替える)。**どちらも利用できない環境のときだけ**
   「Gmail MCP が使えないため中止」と出力して終了する(この場合は最後の完了行を出さない)。
2. メールから企業ごとに以下を抽出する:
   - 選考の動き → stage にマッピング(出願予定=scouted, 出願済=entried, ES・テスト中=task, 面接中=interview, インターン合格=intern, 内定=offer, 不合格・お見送り=rejected, 辞退=closed)
   - 〆切・選考日(面接日程を含む) → nextDate (YYYY-MM-DD)
   - 次にやること → nextAction
   - 業界が分かれば industry、職種・コース・開催区分(1day/3days等)が特定できれば position に入れる
     (同じ会社に複数ポジション・複数コースで応募していることがあり、これがトラックを判別する鍵)
   - name は本文にある表記のままでよい(株式会社/Inc.付きの正式名称でも通称でも、DB側の正規化とエイリアス学習で吸収する)
   - **本人にしかできない依頼は完了まで追跡する**: フォーム回答・書類/口座情報の提出・パスワード設定など
     本人対応が必要な依頼を検知したら、該当トラックの nextAction に「(本人)」を付けて内容を書き、
     nextDate を当日にする。以後、完了(送信控え・先方の受領連絡)がメールで確認できるまで、毎回の実行で
     nextDate を当日へ引き直し、サマリ冒頭にも再掲する(一度通知して終わりにしない。2026-07-21のPKSHA
     フォーム依頼が通知1回きりで7日間滞留し、先方から督促が来た反省)
   - **予定は構造化して取る(最重要)**: 面接・面談・説明会・提出締切は appointments 配列
     `[{at(ISO・時刻まで), endAt(終了時刻。「15:00-15:30」等から。録画の自動停止に使う), kind(面接/面談/締切/説明会/テスト), title, url(Meet/Zoom/Teams/提出ページ), location, person(面接官等)}]`。
     **会議URLと時刻は必ず拾う**(朝のページに「15:00 面接 [開く]」と出すための核)。ref にGmailメッセージIDを入れる。
     会議URLは短縮リンク(weburl.jp・bit.ly・tinyurl.com・x.gd・cutt.ly・is.gd・t.co・lnkd.in・ur0.cc・urx.nu・buff.ly・rebrand.ly 等、例 https://weburl.jp/xxx)で来ることがある。その場合も会議URLとして url に入れる(実ブラウザで開けばMeet等へリダイレクトされ、そのまま自動録画に載る)
3. 同じメールから次の3ファイルを作る(いずれもgitignore済み。対象なしは空配列):
   - 選考差分を sync/sheet-import-loop.json へ [{name,stage,nextAction,nextDate,industry,position,appointments,ref}]
   - Inbox表示用を sync/mail-import-loop.json へ {items:[{id,receivedAt,sender,subject,summary,category,needsAction,deadline,status,company,position,sourceRef}]}
     本文全文は入れず、判断に必要な短いsummaryだけにする。id/sourceRefはGmailメッセージID
   - 提出完了・提出結果が明示されたメールを sync/submission-import-loop.json へ
     [{sourceRef,company,position,kind,submittedAt,result,detail}]。resultは合格/不合格/内定/辞退等、メールで確定できる場合だけ
4. cd sync で次を順に実行し、正本DBへ反映する:
   - npx tsx scripts/db-apply.ts sheet-import-loop.json
   - npx tsx scripts/db-apply-mail.ts mail-import-loop.json
   - submission-import-loop.json が空でなければ npx tsx scripts/db-apply-submission.ts submission-import-loop.json
   - 書き込み規則(終了系は根拠があれば確定・終了からの復活はしない・手書きの詳しいステータスを粗い進行中で潰さない)はスクリプト側で保証されている。
   - 「保留」と報告された企業(複数トラックで特定不能)は、メール本文からどのトラックか判断できるなら position を付けて再実行し、判断できなければサマリで報告する。
   - 「名寄せ要確認」と報告された企業は、DBには書かれていない。**サマリの冒頭で本人に確認**する
     (同じ会社なら `npx tsx scripts/db-alias.ts add <別名> <正式名称>`、別会社なら `db-alias.ts new <名前>` で学習・解決する。学習後は自動で名寄せされる)。
   - 差分が16社以上でブレーキが掛かったら、内容が妥当なときのみ `--force` を付けて再実行する。
   - **応募runの自動追従**: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/application-autopilot.ps1 -Action list`で進行中runを取得し、
     企業とpositionが一意に一致するメールについて、適性検査案内は`assessment_detected`または情報が揃えば`assessment_ready`、
     面接確定は`interview_scheduled`のJSONを`logs/`以下に作り、`application-autopilot.ps1 -Action event -InputJson <JSON>`で反映する。
     `eventId`は`mail:<GmailメッセージID>:<イベント種別>`として冪等にする。paused/failedのrunは自動再開せず本人へ報告する。
     本人承認が必要な`entry_submitted`、`es_submitted`、`entry_es_submitted`、`assessment_completed`をメールから推測して記録しない。
     複数runで特定不能なら保留として本人へ報告する。
5. `npx tsx scripts/db-snapshot.ts` を実行する(アプリへの即時反映+DBの日次バックアップ。プッシュ失敗は警告のみで続行)。
6. `npx tsx scripts/db-mirror.ts` でミラー値を生成し、`mirror-out.json` を Read して、各 writes[] を
   mcp__google-workspace__modify_sheet_values で書き込む(range_name は `'<tab>'!<range>`、values はそのまま渡す)。
   これでシートがDBの最新を映す。シートの条件付き書式・列幅は値の上書きでは壊れない。
6. 受信トレイの整理(Gmailはフラット化する運用):
   - 就活サービス媒体(slogan.jp / br-campus.jp / typeshukatsu.jp / en-courage.com / labbase.jp / openwork.jp / gaishishukatsu.com / gakujo.ne.jp / ibeck.co.jp / offerbox.jp / mynavi.jp / rikunabi.com)の `is:unread older_than:7d` は batch_modify_gmail_message_labels(claude_ai 系なら label_thread / label_message)で TRASH ラベルを付けてゴミ箱へ
   - それ以外の `is:unread older_than:1d` は batch_modify_gmail_message_labels(claude_ai 系なら unlabel_thread / unlabel_message)で UNREAD ラベルを外す(既読化のみ・削除はしない)。選考情報は手順2〜5でDB・シートに反映済みなので見逃しは起きない
   - 当日(1日以内)の未読はそのまま残す(緊急対応の目印のため)
   - **最重要の例外**: 件名・本文に「人事面談・面談調整・Slack招待/ワークスペース・インターン事前準備(事前アンケート/セットアップ/持ち物/宿泊/交通費/キックオフ)・フォーム回答依頼/情報回収フォーム/入社・参加手続き」が含まれ、かつ未対応に見えるメールは**既読化せず未読のまま残し**、サマリの冒頭で個別に報告する。この種の見逃しは選考辞退扱いに直結するため最優先
7. 活動ログに1行残す(本人が「何を・何のために・どうしたか」を後から確認できる状態にするため)。実際の結果を How/Result に入れて実行する:
   `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/log-activity.ps1 -By daily-sync -Action "毎朝の選考同期" -Why "Gmailの新着から正本DBを最新化し取りこぼしを防ぐため" -How "<更新/追加/保留の企業名・件数、既読化/ゴミ箱の件数を簡潔に>" -Link "選考管理シート(ミラー)" -Result "<成功 等>"`
   (更新も既読化も何も無かった日は Action を「毎朝の選考同期(変化なし)」にする)。
8. 最後に結果サマリ(DB反映の更新/追加/保留の企業名・ミラー書き込みの成否・既読化/ゴミ箱の件数)を簡潔に出力する。
   日曜(JST)のみ: docs/detour-list.md を Read し、「未判断」のネタがあれば件数と項目名をサマリに1行だけ含める
   (見直しを促す目印。0件なら何も書かない。リストの編集はしない)。
   **サマリの最終行に、他の文字を付けず単独で半角ASCIIで `=== daily-sync DONE ===` と必ず出力する**(日本語を混ぜない。ログの文字コード次第で日本語が化け、完了判定に失敗して正常でも故障と誤報されるため。この行の有無で正常完了を判定する。全工程を実行できたときのみ出力する)。

注意: シートを直接編集して選考情報を変えない(正本はDB。シート直編集はミラーで消える)。
例外は活動ログタブへの追記のみ。
