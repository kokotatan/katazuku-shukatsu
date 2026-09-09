# katazuku — エージェント引き継ぎ(codex / Claude 共通)

就活生・奥山彪太郎さん(ユーザーは本人1人)の就活を自動運転する個人プロジェクト。
目的: ルーチン・雑務を自動運転し、本人は「考える・受ける・認証する・決める」だけに集中する。
返答・コメント・コミットは日本語。絵文字禁止。

## インターンのスライド作成（2026-09-07 本人訂正）

- インターンのスライドは画像生成で作る。本人だけでなく、他のメンバーも同じ方法で作れるようにする。
- 共有するMarkdown（`.md`）には、画像生成の手順・共通デザイン・コピペできるプロンプト・修正方法をまとめる。各メンバーが内容を差し替えて再現できる形にする。

## 端末の役割分担

- 自動録音は**会議URLのある予定**を対象にし、面接・面談に加えて説明会・セミナー等も含める。インターン参加、宿泊、対面、終日・24時間以上の予定は除外する。インターンの選考面接・面談・説明会は対象にする。個人用とOSSで同じ判定・合成テストを維持する。詳細は `docs/RECORDING-POLICY.md`。

- MiniPC（Windowsホスト名 `KOKOTATANPC`）は常時運転・バックグラウンド処理用、ノートPCは本人の認証・確認・手入力用とする。
- パスワード、パスキー、OAuth同意、メール/SMSコード、CAPTCHA、本人確認など、本人操作が必要になり得るブラウザ作業は、接続中ChromeのうちノートPC上で本人が開いたタブを明示参照してもらったインスタンスを優先する。`KOKOTATANPC` と表示されるローカルprobeはMiniPCの識別子であり、ノートPC判定には使わない。
- Chrome拡張の接続IDは再起動で変わり得るため固定保存しない。候補が複数ある場合は、ノートPC上で本人が開いたタブを明示参照してもらって識別する。
- MiniPCで準備を始めた作業が認証境界に到達した場合、秘密をチャット・ログ・URL表示へ出さず、同じページをノートPC側Chromeへ引き渡して本人がその場で続行できる状態にする。
- ノートPCではCodexをローカル実行し、Chrome・Downloads・OAuth等を同一端末内で扱う。正本DB・snapshot・定常処理だけを`notebook-minipc.ps1`からSSHでMiniPCへ依頼する。別端末のChrome拡張を介したファイル転送は行わない。詳細は`docs/NOTEBOOK-MINIPC-OPERATIONS.md`。

## アーキテクチャ(2026-07-18 DB中心化。docs/specs/08-data.md)

```
data/katazuku.db(正本・SQLite/node:sqlite・gitignore)
   ↑ agent(唯一の書き手): メール / 会話 / 面接録音 / 提出結果 / カレンダー / 企業研究
   ├─→ db-snapshot.ts: 書くたびスナップショットJSONを /api/push へプッシュ(+DB日次バックアップ)
   │      → Vercel Blob → アプリ群が /api/data?key=合言葉 で読む(サインイン不要・数秒で反映)
   └─→ db-mirror.ts → MCPでシートへ(一方向ミラー。スプレッドシートで眺めたい時用+バックアップ)
```

- **DBに書いたら必ず `cd sync && npx tsx scripts/db-snapshot.ts` を実行**(アプリへの即時反映)。合言葉は repo直下 .env
- **面談・面接の予約を扱ったら、その作業内で事前調査と面談準備も行う。** 本人の追加依頼や48時間前を待たず、
  `scripts/meeting-preparation-prompt.md` に従い、企業・相手の一次情報、前回記録、本人の回答素材、逆質問を揃える。
  `sync/scripts/meeting-preparation.ts` が今後の予定を全件再評価し、成果物・出典・現在の根拠hashが揃ったものだけreadyにする。
  通信等で未完了なら理由を台帳に残し、朝の処理・前夜ブリーフで再試行する。予定や相手の変更、48時間以内の最終確認も対象。
  カレンダー登録、既読/processed、完了センチネル、既存descriptionだけで準備済みとしない。詳細は `docs/INTERVIEW-PREPARATION.md`。
- **外部サイトで面接・面談・イベントの日程を確定する直前は、必ずカレンダー同期を実行してから正本DBを照合する**。
  `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/calendar-sync.ps1` の成功後、
  `cd sync && npx tsx scripts/db-appointment.ts conflicts <開始ISO> <終了ISO>` が
  `state: "available"`、`available: true`、`database.role: "canonical"` の場合だけ確定する。
  `unknown`は空きではない。Calendar同期失敗・10分超の鮮度切れ・同期期間外・replica DBはすべて`unknown`として停止する。
  Googleカレンダーの画面だけ、会話要約だけ、記憶だけで空きと判断しない。通常の複数日・終日予定は占有として扱う。
  **候補日時を本人や相手へ提示する段階でも同じ判定を使う。** ただし宿泊予定は滞在期間全体を占有せず、
  Calendar上の宿泊マーカーを `availability=FREE` / `busy=0` とする。チェックイン・チェックアウト、集合時刻と、
  その前後の実移動だけを、時刻付き予定・`appointment_mobility`・`travel_segment`で占有する。
  agentが予定名だけから空きを推測してはならないが、宿泊マーカーが誤ってbusyなら、本人の指示またはカレンダー入力を
  根拠に通常経路でfree/busyと移動データを訂正し、再同期後の正本判定で空きを決める。
- **第三者への確定操作を一律禁止しない。必ずkatazukuの事前検査済みExecutorを通す**。
  メール送信、フォーム提出、日程回答、予約確定、取消・変更通知は、本人が宛先・本文・日時・通知内容を
  確認して「送って」「提出して」「任せる」等と指示した後、同じaction hashの操作をExecutorが実行してよい。
  本人確認後も下書きで停止する必要はない。反対に、ログインやMFAの完了だけを本文確認の代わりにはしない。
  Gmail/Calendarの直接コネクタで確定せず、`sync/workflows/third-party-email.json`等の契約を通す。
  Executorは直前に元スレッド、正本DB、Calendar同期鮮度、予定・移動・前後バッファ、送信済み履歴を再照合する。
  `unknown`、根拠不一致、成功済み、成否不明では確定しない。
  日程変更理由は必要な場合だけ「大学・研究上の都合」等の中立表現にする。
  「他社の選考」「他のインターン」「面接があるため」など、相手に不要な第三者情報は本文へ書かない。
  headlessのmail-watchは本人へactionを提示できないため下書きで止め、対話セッションのExecutorへ引き継ぐ。
- **締切付き提出物は、通知やカレンダー登録だけで対応済みにしない。** メールを受けた時点で誓約書・証明書・
  スライド等を成果物1件ずつ `submission_requirement` へ分解し、提出先の公式手続、必要項目、添付物、所要営業日を
  調べ、本人の最終承認直前まで前倒しで準備する。本人には原則「この内容で提出してよいか」だけを求める。
  `mail-watch-state.json` のprocessed、既読化、カレンダー登録、別成果物の提出をもって完了扱いにしてはならない。
  外部フォーム・メール・予約の確定だけは、内容を固定して本人承認後にExecutorで実行する。
  提出完了メール、受付画面、相手の受領確認等の根拠がある場合だけ `completed`、不要の明示がある場合だけ
  `waived` とする。MiniPC停止後の復旧時も `submission-readiness.ts` が未完了全件を再評価する。
- スキーマ: company(name=正式名称/short_name) / selection(+outcome列挙) / **appointment(面接・締切の日時/URL/場所/相手)** /
  event(+ref=元メールID) / company_alias / pending_review / mail_item / submission / company_dossier /
  interview_note / meeting_run / person / person_note / appointment_person / person_photo / profile_basic / profile_suggestion
  / application_run / application_event / application_material / web_assessment
  / place / mobility_profile / appointment_mobility / route_estimate / travel_segment

- **DBへの入力は6本(2026-07-18本人定義)**: ①メール(daily-sync/mail-watch) ②会話(本人→agent)
  ③面接の録画・録音(interview-digest) ④提出結果(submit系エージェント) ⑤カレンダー ⑥調査結果(企業研究)。
  **6本すべて接続済み(2026-07-18)**。専用入口は db-apply-mail / db-apply-interview / db-apply-submission /
  db-apply-calendar / db-apply-research。カレンダー・Gmail・企業研究の実走には各コネクタとWindows定常タスクが必要
- **書き手はagentのみ**。人はシートを直接編集しない(ミラーで消える)。人の修正依頼は会話でagentが受けてDBに書く
- ステータス更新は `sync/src/db.ts` の `transition()` に集約(終了系は根拠があれば確定・終了からの復活なし・
  手書きの詳細ステータスを粗い進行中で潰さない・「辞退予定」は内定通知でも上書きしない)
- 名寄せ `sameCompany`: NFKC正規化・部分一致は両方4文字以上のみ(トヨタ⊂トヨタ・コニック・プロ誤マージ対策)
- シート(ID 1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM)のタブ「選考管理（新）」「企業マスタ（新）」がミラー先。
  「活動ログ」タブと logs/activity-log.jsonl に、自律処理は「何を/何のために/どうしたか」を必ず1行残す
  (scripts/log-activity.ps1)

## テスト(変更したら必ず全部通す)

```
cd sync && npx tsx scripts/check-db.ts     # DB遷移規則・apply・mirror・6入力(75項目)
cd sync && npx tsx scripts/check-sheet.ts  # 旧シート書込エンジン(40項目・移行完了まで残す)
cd sync && npx tsx scripts/check-application.ts # 応募の承認・安全境界・冪等化(21項目)
cd sync && npx tsx scripts/check-mobility.ts # 場所・対面/オンライン・移動・snapshot分離(15項目)
cd sync && npx tsx scripts/check-agent-runtime.ts # provider切替・副作用境界・schema・CLI版差(25項目)
cd sync && npx tsx scripts/check-daily-sync-apply.ts # daily-sync決定論executor(schema拒否・冪等・ブレーキ・失敗隔離)
npm run build                              # board(管理画面)ビルド + sync全チェック
```

## 進行中のタスク(2026-07-18時点)

1. **【完了 2026-07-18】アプリ群は残し、DB読取へ移行**: シートは見えにくいので人間用UIはアプリ群。
   廃止は「各アプリがlocalStorageを正として持つこと」だけ。inbox/status/profile/people/prep/impactは
   共通 @katazuku/data で /api/data を読む。insight/boardも同じsnapshotを読む。
   **見た目はSmartHR Design Systemのまま維持**(本人が気に入っている。刷新はしない。細部改善のみ可)。
   api/ のみ廃止のまま(履歴はタグ apps-archive-20260718)
2. **外部実走確認のみ残る**: daily-sync/calendar-sync/asa/mail-watchは実装済み。calendar-syncは5分ごとのWindowsタスクで常時同期する。
3. **board/の実機確認**: katazuku.kotalabo.com にデプロイ後、スマホでOAuth→表示確認
4. **次の構想**: 企業研究・面接対策パイプライン(deep research・IR・ブログ/動画・OBOG・業務/顧客/技術理解を
   企業ごとのdossierに集約し、DBと面接準備に接続する)。着手前に本人と設計を確認する
5. **【完了 2026-07-18】人脈/基本情報/顔をDBへ移行し、面接から自動更新**:
   - people(面接官)・個人マスタの基本情報・面接官の顔写真を DB に投入し、`board/` から見えるようにする(spec07/08/10)。
   - 面接録音→議事録(interview-digest)から、面接官→people と、自己PR系(strengths/weaknesses/careerAxis/
     desiredRole/desiredIndustry)を **DBへ自動更新**。氏名・住所等の確定情報は上書きしない(候補追加のみ)。
   - **シード(移行の種)**: 面接官11名・基本情報一式・顔3枚(川島=JAFCO/関根=LayerX/富士元=リンク・アイ)は
     `Downloads/katazuku-people-import.json`・`katazuku-profile-basic.json` と、`logs/interviews/`・
     `chrome-prompts/submit.local.md` から再生成可能。証明写真は Bash `cp` で `katazuku-files` から取得可。
   - 顔取得ロジック: 公開情報(公式チームページ/Wantedly本人)から `curl`+`ffmpeg`で256px化→本人確認(名前+会社+経歴一致)。
   - 今後の面接で顔を自動取得したいなら、会議ウィンドウのスクショsamplerを `record-audio` 系に追加。

6. **【完了 2026-07-18】トラック重複の整理**: position照合が厳格すぎて、
   エクサウィザーズ/八洲電機/LayerX/日本トレカセンター/PKSHA に既存と同じ話の別トラックが追加された。
   samePositionを包含許容+空欄昇格へ緩和し、db-merge-tracksで5組を関連イベントごと統合済み

7. **会議自動運転の次段(codex設計 2026-07-18を採用)**: 現状は meeting-autopilot.ps1 が
   「DB予定→10分前に開く→開始5分後にrecord-audio→終了+3分停止→議事録→完了化イベント」まで実装済み。
   次にやる: (a) カレンダーコネクタ→appointment upsert(external_id/end_at/hash付き。LLMの毎回カレンダー検索を廃止)
   (b) meeting_run状態機械(armed→opened→recording→…→done。予定ID単位の一回限りタスク+WakeToRun)
   (c) 会議終了の実検出(会議窓消滅15秒→予定終了後の無音90-120秒→終了+30分強制停止の順)
   (d) 議事録→DB反映は自由記述でなく厳格JSON+専用CLI(db-apply-interview)で1トランザクション。event.ref=run_idで冪等化
   (e) personスキーマ: person / appointment_person / person_note(追記専用・根拠ref+confidence) /
       person_photo(storage_key・sha256・verified_at。**画像はsnapshot/gitに出さず認証API配信**)。spec10担当と共同
8. **【完了 2026-07-18】抽出強化**: daily-syncのappointmentsはendAtを取得し、カレンダー入力(⑤)も接続済み
9. **応募自動運転の外部実走**: 状態機械、承認ゲート、適性検査の安全境界、DB→カレンダーoutboxは実装済み。
   次は各社サイトでエントリー・完成済みES転記・本人承認後の送信・面接予約を実走し、
   サイト別アダプターと回帰fixtureを蓄積する。設計はdocs/specs/11、OSS論点はdocs/oss-roadmap.md。
10. **移動を含む日程調整**: place / mobility_profile / appointment_mobility / route_estimate /
    travel_segmentのDBとCLIは実装済み。次は候補日時のfeasible判定、経路adapter、
    移動ブロックのカレンダー反映を実装する。住所・移動履歴はsnapshotへ出さない。設計はdocs/specs/12。
11. **モデル非依存エージェント実行基盤**: Phase Aの共通runner、Codex/Claude/local OSS adapter、
    failure分類、fake provider試験、応募・企業研究の共通入口化は完了。外部状態を再取得できるworkflowは
    `reconcile`で完了済み操作を照合して別providerが続行し、再照合できない操作はcheckpointから再開する。
    **Phase B着手(2026-07-20)**: daily-syncのDB書込経路を「抽出(read-only厳格JSON)→決定論executor
    (daily-sync-apply.ts)」へ分割。schemaはsync/schemas/daily-sync-result.schema.json、抽出プロンプトは
    scripts/daily-sync-extract-prompt.md、オーケストレータはscripts/daily-sync-v2.ps1。既読化・シート
    ミラー等の副作用は未分離で従来daily-sync.ps1に残す。実走でCodex CLIの版差(--search廃止→
    tools.web_search config、引数エラーの安全分類)も修正。次はcalendar-sync/mail-watch/asaを同型で移行。
    設計はdocs/specs/14。
    **workflow工程制御(2026-08-24)**: stepごとのowner・capability・副作用・承認・冪等性・遷移を
    `sync/workflows/*.json`で宣言し、`workflow-control.ts`が順序、正本DB identity、契約hashを強制する。
    実行台帳は`logs/workflow-runtime.local.db`へ分離。daily-sync-v2は
    `prepare→extract(Agent)→validate→apply→snapshot→audit`へ接続済み。第三者確定操作は、提示action全体の
    hashと同一作業内の本人承認が一致する場合だけExecutorが実行できる。次はmail-watch/asaを契約へ移行する。
    **Claude週制限の自動引継ぎ(2026-07-24)**: 実文言`weekly limit · resets ...`を検知し、復活日時を
    `logs/agent-runs/provider-health.local.json`へ保存。期限まではCodexへ即時切替、期限後の次runでClaudeを
    再優先する。コード・文書開発は`workspace`、Gmail・Calendar等の運用は`reconcile`でCodexが継続する。
    Google Workspace MCPをGmail・Calendar・Drive・Sheetsへ対応し、Voiceboxも実行時接続する。
    scripts配下のprovider直呼びは全廃し、旧daily-sync/mail-watch/asa/calendar-sync等8本も切替対象。
    開発入口は`scripts/run-agent-task.ps1`、運用説明は`docs/AGENT-FAILOVER.md`。

## 禁止・注意

- `credentials/`・`.env`・service-account.json・`data/`・`logs/`・`*.local.md` はコミットしない(gitignore済)
- 選考ステータスを機械的に上書きする変更を入れない(必ず transition() 経由)
- 選考メール・ES の事実は chrome-prompts/submit.local.md(台帳)が正。勝手に事実を創作しない
- Webテスト・コーディングテストの代行受験は不可(本人受験)
- デザイン: SmartHR Design System 準拠(smarthr-ui / Tailwindトークン / system-ui。詳細はCLAUDE.md)
