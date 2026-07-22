# Spec 11: 応募自動運転

最終更新: 2026-07-19

## 目的

28卒の日本の新卒就活について、企業へのエントリー開始から、完成済みESの転記、提出、
Web適性検査の準備、面接予約、カレンダー反映までを1本のrunとして追跡する。

本人が担うのは、志望方針を決める、送信内容を最終確認する、本人認証をする、
Web適性検査を受ける、面接を受ける、意思決定することである。

## 境界

- agentは確定済みプロフィールと完成済みESを正確に転記する
- エントリーとESの最終送信には、その画面内容に対する本人の明示承認が必要
- 既存Chromeのログイン状態を優先する
- パスワードはSpec 13のローカル資格情報ブローカーが正確なoriginと欄typeを検証できる場合だけ入力する。普段使いのChromeへ安全に接続する境界が未完成の間は本人へ引き継ぐ
- メール認証、SMS、MFA、CAPTCHAなどの本人確認は本人へ引き継ぐ
- 本番Web適性検査は本人が受検する
- agentは検査種類、期限、所要時間、環境、許可された持ち物、公式練習先を整理できる
- 問題の保存、解答生成、解答入力、代理受検は行わない
- 面接予約は本人が事前指定した可能時間帯の中だけ自動確定できる

## 全体フロー

~~~text
応募run開始
  → フォーム入力
  → 本人の最終確認
  → エントリー・ES送信
  → 適性検査情報の整理
  → 本人受検
  → 面接候補と空き時間の照合
  → 予約
  → appointment
  → calendar outbox
  → 外部カレンダー
~~~

企業によってESや適性検査がないため、途中段階はスキップできる。

## 状態機械

application_run.state は次のいずれか。

| 状態 | 意味 |
|---|---|
| started | run開始 |
| entry_review | エントリー入力済み、本人確認待ち |
| entry_submitted | エントリー送信済み |
| es_review | ES転記済み、本人確認待ち |
| es_submitted | ES提出済み |
| assessment_pending | 適性検査を検出、情報整理中 |
| assessment_ready | 本人が受検できる状態 |
| awaiting_interview | 本人受検済み、面接案内待ち |
| interview_scheduled | 面接予定確定 |
| paused | 本人確認または追加情報待ち |
| failed | 再開に作業が必要 |

application_event.id を冪等キーとし、同じイベントを二重反映しない。
paused と failed から処理を続ける場合は resumed が必要。

## DB

### application_run

企業の1応募を表す。selectionへ紐付き、現在状態、応募URL、完成済み資料の参照先、
開始根拠、エラー、開始・更新・完了時刻を持つ。

### application_event

run内の状態変化を追記する。本文や適性検査の問題は入れず、件数、生成した予定ID、
本人承認の有無など最小限のメタデータだけをdata_jsonへ入れる。

### application_material

ES本文を保存しない。設問、転記元、本文SHA-256、文字数、上限、準備状態だけを保存する。
個人用の完成済みESはgitignoreされた台帳など、別の機密領域に置く。

### web_assessment

検査種類、提供元、URL、締切、所要時間、予約時刻、持ち物、環境確認状態、本人受検状態を持つ。
問題、解答、スクリーンショットを受け付けない。

### submission / appointment / event

既存テーブルを使う。selection.statusは必ず transition() を通す。
面接や検査締切はappointmentへ入り、external_idが空の予定だけcalendar outboxに出る。

## 承認ゲート

次のイベントは approvedByUser が true でなければ、トランザクション全体を拒否する。

- entry_submitted
- es_submitted
- entry_es_submitted
- assessment_completed

これはブラウザ用プロンプトだけの注意書きではなく、DB書き込み関数側の制約である。

## CLI

本人向けの入口は会社名だけで開始できる。企業研究と公式応募経路の特定も同じセッションで行い、
職種・コースが複数ある場合だけ本人へ確認する。

~~~powershell
katazuku apply <会社名>
katazuku research <会社名>
~~~

`apply-company.ps1`は同じ会社・職種・シーズンから安定したSOURCE_REFを作る。会社名だけで開始して職種を後から選んだ場合は、
確定職種を含めて実際のSOURCE_REFを作る。中断後に再実行した場合は既存runを再開し、重複応募runを作らない。

機械入力の契約はschemas/application-start.schema.jsonと
schemas/application-event.schema.jsonで公開する。追加項目を暗黙に受け付けず、
ES本文、適性検査の問題・解答をイベント形式へ入れられないようにする。

~~~powershell
scripts/application-autopilot.ps1 -Action start -InputJson start.json
scripts/application-autopilot.ps1 -Action event -InputJson event.json
scripts/application-autopilot.ps1 -Action list
scripts/application-autopilot.ps1 -Action assessments
~~~

低水準CLIは sync/scripts/db-application.ts。PowerShellランナーは書き込み後に
db-snapshot.ts と活動ログを実行する。

カレンダーへの出力は次の2段階。

~~~powershell
cd sync
npx tsx scripts/db-calendar-outbox.ts
npx tsx scripts/db-link-calendar.ts links.json
npx tsx scripts/db-snapshot.ts
~~~

外部カレンダー作成が成功した項目だけexternal_idを戻す。これにより再実行時の二重作成を防ぐ。

## ブラウザ実行

chrome-prompts/09-application-autopilot.md を正本とする。サイト固有の操作知識は
08-browser-entry-knowhow.mdへ分離し、状態機械と安全境界はサイトごとに複製しない。
パスワードをモデルへ渡さないローカル単一ユーザー向け境界は
13-local-credential-broker.mdを正本とする。SaaS、遠隔利用、複数ユーザーは対象外である。

## 未完了の外部接続

- 外部カレンダーを定期巡回してoutboxを作成するジョブ登録
- 面接可能時間帯を構造化して保存する設定
- サイト別アダプターの蓄積と回帰テスト
- boardでapplication_runとweb_assessmentを表示する画面

Chrome実走の入口は実装済みだが、各社サイトでの回帰確認は応募の都度蓄積する。
外部サイトへの送信は認証状態と本人承認が必要である。
