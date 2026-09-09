# katazuku 開発進捗

最終更新: 2026-09-08

## 活動記録を日付から振り返る（2026-09-08）

- 件数・結果中心の画面を、月のカレンダーと選択日の時刻順の記録へ変更。月移動・今日への移動、矢印キーでの日付選択、URLによる選択日の保持に対応。
- 予定・受信メール・提出や返信の実施記録・会話メモ・Codex等の作業記録・面接・企業研究を、認証済みsnapshotからまとめて表示。種類で絞り込み、内容・目的・結果・元の記録を開ける。定期同期などの自動処理は初期表示で折りたたむ。
- 実際の活動ログの項目は`ts/action/by`。旧画面の`at/what`との不一致を解消し、旧形式も読めるようにした。日本時間の日付境界、時刻未設定、日付不明、複数日予定、同一eventや提出・面接記録の重複を扱う。
- メールの「現在は返信済み」という状態から返信日を推測しない。受信は受信日、対応は実際に保存された日時へ表示する。ターミナルの会話全文の自動取込は未接続で、表示する会話は保存済みの要約・作業記録が対象。
- snapshotの既存の取得範囲は維持（活動ログ最新50行、mailItems/enrichedEvents最新200件など）。空の日は「表示できる記録はありません」とし、活動がなかったと断定しない。履歴の全件取込や保持期間の拡大は今回行っていない。
- スマホでは日付タップでその日の記録へ移動し、「日付を選ぶ」でカレンダーへ戻れる。認証前もカレンダーと日別記録の配置だけを薄く表示し、内容や件数を作らない。
- 日付・出典・重複等17項目と、実データを使ったブラウザの操作13項目を確認。320px幅の詳細表示・PC表示、認証前のAPI通信なしを確認。
- 全8アプリのビルド・全チェック、Cloudflareの検証を通過し、version `4272b864-c383-4573-bb75-6801ce10cce0` で反映済み。配信中8画面のアセット一致、活動記録の認証前表示、データ・写真APIの未認証401を確認。

## 合言葉入力前に画面の構成を見せる（2026-09-08 本人訂正）

- 架空データを返す処理と表示例の案内を取り下げ。会社・人物・メール・件数などの仮データを配信物から削除し、未入力時のデータ取得はnullを返す。
- 8つの閲覧画面に、見出し・列・行・区切りと、内容の位置を示す静止した灰色の線だけを薄く表示。合言葉の入力欄を手前に配置する。背景に実データを置いたり、ぼかして隠したりしない。
- 合言葉の入力中・通信中・エラー時にも入力欄を維持し、認証後に取得した情報だけを表示する。背景の枠組みはinert・aria-hiddenで操作と読み上げから除外。
- 全8アプリのビルドと既存チェック、認証境界6項目を通過。配信JavaScriptから以前の仮データと生成処理が除かれたことを確認。
- ブラウザで8画面の320px幅、PC表示、未入力時のAPI通信ゼロ、操作対象からの背景除外、合言葉不一致・通信中の入力保持・認証後の切替・503時の取得済みデータ保持を確認。Cloudflareへ反映済み（version `86c6f976-a0db-4e97-a194-e80d087cedb7`）。配信中8画面のアセット一致、データ・写真APIの未認証401を確認。

## 自動ログインをGUIから設定（2026-09-08）

- 端末設定画面の上部に「ホームに戻る」とロゴのホームリンクを追加。ローカルサーバーの `/` へ戻ると設定画面へ循環するため、アプリ本体のホームへ移動する。未保存の変更がある場合はブラウザの離脱確認を出す。
- 管理画面の「設定」から、Windows PC上の自動ログイン設定へ進む導線を追加。対象サービス・毎日の時刻・有効／停止を保存できる。
- OSSの作業ツリーにも同じ設定画面を追加。Goodfind、外資就活ドットコム、LabBase就職、ビズリーチ・キャンパス、リクナビ、ワンキャリア、OfferBox、キミスカ、dodaキャンパス、Ｒｅ就活キャンパスの正式名称10件を候補にし、候補外のサービス名も入力できる。
- 配布するログイン先は空にし、URL・認証方法は本人がGUIで設定する。既存5件の接続先は端末内へ保持。接続先変更時は認証情報・専用Chromeの設定世代を分け、旧ログイン情報を再利用しない。
- 認証情報の登録・変更はそのPCのDPAPIへ保存し、SSOや追加認証は専用Chromeで本人が操作する。登録有無と直近の実行結果も表示する。
- 起動は `scripts/open-local-login-settings.vbs` のダブルクリックに対応。画面表示時は既存タスクを読み、保存時だけ既存の `katazuku-local-login` を更新する。
- 設定を日次ランナーへ接続し、停止・対象外は実行前に除外する。PowerShell 5.1のJSON配列が二重になる問題を0/1/2件の合成実行で検査する。
- 端末内HTTPのHost・Origin・セッショントークン、秘密値の非公開、古い画面の上書き拒否、保存失敗時の復元を検証。実タスク・実サイトは試験では操作しない。クラウドへのデプロイは未実施。
- 全体ビルドと既存チェックを通過。GUIの境界79項目・Windows連携37項目・既存ブローカー48項目を検証。OSSも個人情報遮断リスト付き全チェックとboardビルドを通過。ブラウザで空の初期設定、正式名称の候補、URL検証、追加・変更・登録と再表示、390px幅を確認。Gitへの反映・外部公開は未実施。

## ノートPCの録音状態を常駐表示（2026-09-08）

- 画面右下へ録音状態の小窓を追加。停止中・開始確認中・録音中と経過時間・保存停止・状態不明を表示する。ドラッグで移動でき、位置を復元する。
- DB上の開始指示ではなく、実際のffmpegプロセスと音声ファイルの増加で判定する。監視結果が10秒以上古い場合は状態不明にする。
- 本人のStartupフォルダーへ登録済み。録音開始時にも表示を戻し、名前付きMutexで重複起動を防ぐ。表示操作は録音処理から独立。
- 画面共有中に邪魔になるという本人の指摘を受け、小窓とメニューへWindowsのキャプチャ除外を適用。タスクバーへの表示を除き、手元での確認を維持する。適用できない環境では小窓を隠す。
- Ctrl + Alt + Shift + Rで表示・非表示を切り替えるグローバルショートカットを追加。Shiftなしは実機で競合するため使用しない。録音を識別して開始時に自動表示し、同じ録音の更新・録り直しでは本人が選んだ非表示を維持する。表示操作11項目と録音判定21項目を確認。
- 境界17項目・4状態の描画・実際の録音中表示・起動の重複抑止・既存アプリの全体ビルドと全チェックを確認。コード・音声・予定データの外部公開は行っていない。

## 公開HP・私用GUIのドメイン分離（2026-09-08）

- 公開HPを `katazuku-shukatsu.kotalabo.com`、私用GUIを `katazuku-app.kotalabo.com` に分離し、Cloudflareへ配置。旧 `katazuku.kotalabo.com` はDNS編集権限がないためVercel向けCNAMEを維持。
- 公開HPはネクタイロゴの青、余白のある日本語の見出し、情報が整理される図解で構成。独立した `site/` から公開15ページ・404・記事Markdown・RSS・サイトマップ・構造化データ・llms.txtを生成する。
- Windows/Macの導入、日々の使い方、Cloudflareの現在地、GitHub/npm/Star/Issue/PRへの導線を実装。記事6本とnote投稿用原稿を作成（noteへは未投稿）。
- GitHubから新規cloneした環境でinstall、doctor、架空snapshot生成、boardのbuild/devを実行。PC・390px幅、スマホメニュー、OS切替、コピーを検証。
- 現在のOSSにはGoogle連携、日記自動生成、GUIを含むCloudflare一括導入は未搭載。公開HPでその境界を明記し、完成済みとして宣伝しない。

## 閲覧中心のUIとブランドを統一（2026-09-08）

- ネクタイロゴの青を操作色にし、制作表記を「Kotaro Design Lab.」へ統一。SmartHR部品の基本構成は維持。
- スマホ下部を「今日・企業研究・人・メール・その他」に変更。英語の内部名称と常設の説明文を削減し、任意で開く「使い方」を用意。ダイアログはEscapeとフォーカス制御を備える標準要素を使用。
- 人物画面を検索付きの一覧・詳細にし、顔・出会った場面・全会話メモを日付付きで表示。企業研究と人物詳細の相互リンク、企業資料の日本語見出し・出典・面接記録の閲覧を整備。
- 企業ロゴの表示経路を追加。各社の確認済みロゴ素材は未登録。写真の正本・認証配信とDB同期には変更なし。
- 検証は架空データで実施。全体ビルドと既存テストが通過。検索・全会話表示・詳細と一覧・使い方・下部ナビ・ロゴ・長い日本語の表示を確認。2026-09-08にCloudflareへデプロイ済み。スマホ実機のインストール確認は未実施。


## interview-digest無言死の根本修正・モバイル下タブ再設計ほか(2026-07-29 午後)

- **interview-digestの無言死を修正**: EAP=Stop下で `npx … 2>&1 | Out-File` すると、stderr 1行(npm更新通知等)が
  NativeCommandErrorになりスクリプトごと即死する PS5.1 の罠を踏んでいた(SHIFT面談の文字起こし直後に実害)。
  native実行中だけEAPをContinueへ落とし成否は終了コードと成果物で判定+致命エラーをログへ書き残すtrapを追加。
  再発時も痕跡が残る。meeting-autopilot / record-audio は元からContinueで無事
- **モバイル下タブ再設計(本人指摘)**: 8項目の横並びをやめ、主要4タブ(ホーム/メール/選考/今日)+「その他」
  ボトムシート(個人マスタ/人/面接準備/効果)へ。AppNav.tsx(7アプリ、コピー同期)と landing/index.html の両方。
  iPhoneセーフエリア(env(safe-area-inset-bottom))対応も追加
- **前夜ブリーフ・prepパックに「面接で話す核」を固定掲載**: ガクチカの学び(問いの設定が一番価値)と
  就活の軸3観点(市場/風土/経営陣)。submit.local.md §8にも「学んだこと」を追記
- SHIFT小久保さん定期面談(7/29)は再実行で議事録化完了(interview #10)。スクショ2枚に面接官の顔がなく写真登録は保留


## 無音停止対策・前夜ブリーフ・人物マスタ修復ほか(2026-07-28 午後)

- **番犬(katazuku-watchdog)**: AI非依存の純PSで4時間おきに活動ログ鮮度とprovider健康を監視。
  異常時のみトースト+Push+alert。初回実行で当日daily-syncの無音停止(終了コード0のMCP未接続中止)を実検知
- **フェイルオーバー補強**: 「MCPが使えないため中止」の明示宣言をcapability_missingとして次providerへ
  引き継ぐ(agent-runtime)。回帰テスト追加
- **前夜ブリーフ(katazuku-evening-brief 毎晩20:15)**: 明日の面接・面談の相手人物表・過去面接記録・
  想定問答を自分宛メールで送付(brief-data.tsでDB集約)。初回実行成功
- **Push配線**: watchdog異常・daily-sync当日締切をスマホWeb Pushへ。本人のスマホ購読も完了
- **人物マスタ修復**: 表記ゆれで26件重複(53人→27人)を統合。upsertPersonに敬称・空白・社名の
  正規化名寄せを実装(テスト付き)。db-person.ts(list/merge/note/dupes)新設、日曜週次レポートで重複疑いを報告
- **面談スクショ顔取得**: 会議3分後・10分後に画面キャプチャ→digestが顔を切り出し既存写真パイプラインへ
  登録(本人・セルフビュー除外、既存写真は上書きしない)。新規人物の氏名Web確認ルールも追加
- **指示メール**: 件名【指示】の本人発メールをmail-watchが実行(調査・DB・カレンダー・下書きまで)
- **daily-sync運用規則**: 本人対応待ちタスクを完了確認まで毎日再掲(PKSHAフォーム7日滞留の反省)、
  日曜週次レポートのメール送付を追加
- Zenn下書き3本(番犬・面接パイプライン、既存の週制限フェイルオーバーと合わせて公開待ち)


## PWA化とWeb Push(spec16 スライス1・2、2026-07-28)

- landingをPWA化: `manifest.webmanifest`+最小Service Worker(シェルキャッシュ+Push受信のみ、/api/は素通し)。
  manifestにstart_urlを書かず、ホーム画面追加時のURL`?key=合言葉`をそのまま起動URLにすることで、
  合言葉が公開ファイルに載らないまま初回起動時にlocalStorageへ保存され、以後の入力が不要になる。
- Web Push基盤: 購読の保存口`api/push-subscribe`(合言葉認証→Private Blob `push-subscriptions.json`)、
  送信口`api/push-send`(write secret認証、web-push/VAPID、失効購読の自動掃除)、
  手動送信`scripts/push-send.mjs`。VAPID鍵は`.env`とVercel env(production/preview)に登録。
  landingに「通知を有効にする」ボタンを追加(iOSはホーム画面起動時のみPush可)。
- アイコン: codex CLI経由の画像生成は動作確認できたがAI生成の「片」は字形が崩れるため、
  フォント描画(Yu Gothic UI Bold・teal #00C4CC)の`tools/gen-icon-fallback.ps1`を採用。180/192/512を生成。
- 残り: iPhone実機でのホーム画面追加+通知1通の受信確認(本人)→asa連携(毎朝自動送信)→全アプリ展開。


## Claude週制限からCodexへの自動引継ぎ(2026-07-24)

- Claude CLIの実制限文言`You've hit your weekly limit · resets Jul 26, 9pm (Asia/Tokyo)`を実測し、
  従来regexが`weekly limit`を認識せず`runtime_error`にしていた不具合を修正。終了コード0でも高確度の
  制限文言を失敗として扱う。
- 復活日時をタイムゾーン込みでUTC化し、gitignore済み`provider-health.local.json`へ保存。
  期限まではClaudeを起動せずCodexへ回し、期限後の次runでClaudeを再優先、成功時に状態を解除する。
- コード・文書向け`workspace`副作用モードを追加。Claudeがファイル変更後に急停止しても、Codexへ
  作業ツリー・差分の先行確認と未完部分だけの継続を指示する。外部送信等の`direct`は従来どおり
  結果不明時の自動切替を禁止。
- 開発入口`scripts/run-agent-task.ps1`と運用書`docs/AGENT-FAILOVER.md`を追加。
- repo/親階層の`.codex/config.toml`からGoogle Workspace MCP設定を検出し、Gmail・Calendarの論理capabilityを
  Codexへ自動付与。設定済み端末では`daily-sync-v2`等もClaude制限中にCodexへ切替可能。
- Windows制限環境で`spawn`がeventではなく同期例外`EPERM`を投げてもrunner外へ漏らさず、共通failureとして
  次providerへ進めるよう補強。doctorもクラッシュせずprovider別の失敗を報告する。
- 外部操作向け`reconcile`モードを追加。前providerが途中停止しても、次providerがGmail・Calendar・Drive・DBを
  再取得し、宛先・件名・時刻・sourceRef・runIdで完了済み操作を除外して未完了分を続行する。
- 残っていたPowerShell 8本のprovider直呼びを全廃。daily-sync、mail-watch、asa、calendar-sync、
  reconcile-calendar、open-meeting-urls、katazuku、interview-digestを共通runnerへ移行した。
- Google Workspace capabilityをGmail送信・Drive・Sheetsまで拡張。面接議事録ではVoicebox MCP URLを
  Codexの実行時configへ渡し、Claude制限中もローカル文字起こしから継続できるようにした。
- 22:03のWindows定常calendar-syncで実走し、保存済み週制限によりClaudeをskipしてCodexが起動。
  Calendar 47件を処理し、追加1件・更新5件・変化なし41件、DB snapshotまで完了した。途中で回復した
  tool errorを終了後も失敗扱いする誤判定を発見し、終了コード0では明示的な週制限だけを失敗扱いするよう修正。
- agent-runtime回帰試験25件、TypeScript型検査、PowerShell構文検査に成功。


## データ基盤の見直しと他モデル対応の整備(2026-07-22)

未コミットだった蓄積を機能単位で確定(mobility基盤 / provider非依存agent-runtime spec14 / ローカル資格情報ブローカー spec13 + パスワード非出力化 / daily-sync v2 / チェック配線・gitignore・docs)。その上で2本の批判的レビューを実施し、安全に効く改善だけ実装した。

- **データ基盤(spec08)の評価**: 単一ユーザー・単一書き手・ローカル正本という設計は身の丈に妥当で現状維持でよい、が結論。Postgres/イベントソーシング等は過剰。実装の穴3つのうち2つを修正:
  - node:sqlite(experimental)に載る正本を守るためNodeを24系へ固定(`.node-version`/`engines`)
  - db-snapshotのバックアップ前に`PRAGMA integrity_check`で破損を早期検知
  - openDbが`PRAGMA user_version`へスキーマ版を刻み、将来の破壊的マイグレーションを番号で束ねる土台に(回帰テスト1件)
- **他モデル対応の評価**: agent-runtime基盤は堅い。ただし常駐/定時ジョブ8本がまだ`claude -p`直呼びで、直呼び禁止lintは2本しか守っていなかった。全`scripts/*.ps1`を走査し、既知の未移行8本以外の直呼びをビルドで止める網を追加(新規debtの混入防止)。
- **新規コードの敵対的レビュー(2本)**: agent-runtime/daily-sync/mobility/db-apply と 資格情報ブローカーを精査。
  - **実バグ1件を修正**: daily-sync-applyで複数トラック企業のメール(position無し)が`resolveSelectionId`例外→メール処理ごと巻き戻り後続の提出反映まで停止し部分適用になっていた。メールの選考特定失敗を1件隔離(提出物と対称)。回帰テスト3件。ついでにagent-runtimeのstdinエラーガード追加。
  - **ブローカーはコア健全(重大な隠れバグなし)**: 平文漏洩経路なし・origin検証3層・欄type検証・DPAPIの使い方いずれも健全と確認。fixtureサーバのloopback限定化(0.0.0.0→127.0.0.1)だけ実施。fill評価のisolated world化は低優先の多重防御として保留。
- **未決(本人判断が要る)**:
  1. **クラウド露出**: snapshotに面接メモ・人物名・プロフィール等の個人データが入りVercel Blobへ。読み取りは`?key=`合言葉1本(ブラウザ埋め込み・失効なし・CORS `*`)。CLAUDE.mdの「配信物に個人データを含めない」と食い違う。現状維持か、機微データ除外/短命署名URL化か。spec08に実態を明記済み。
  2. **【完了 2026-07-24】他モデルの本丸**: Google Workspace MCPのcapability mapを拡充し、Voiceboxも実行時接続。8本の直呼びスクリプトを共通runnerへ移行した。外部副作用は再照合付きで継続する。
  3. **CLAUDE.md記述の陳腐化**: 「api/ は廃止」とあるが `api/data.ts`・`push.ts`・`photo.ts` は現役(snapshot配信の要)。要更新。
  4. **ブローカーの共有origin対策(spec13 残作業#3)**: origin一致のみで path を見ないため、`job.axol.jp`等の共有originポータルで企業を取り違え得る。実ポータルへ有効化する前に allowed_path_prefix 対応が必須。照合ポリシーの変更=セキュリティの核なので本人が方針確認のうえ実装する(PoCは未配線のため現状ライブ影響なし)。


## モデル非依存エージェント基盤: Claude優先化とCodex Sandbox修復(2026-07-19)

- 共通runnerの既定provider順をClaude優先(`claude,codex,codex-oss`)へ変更。基本運用はClaude Code、Codex/ローカルOSSは代替と位置付け(spec14)。
- Codex WindowsサンドボックスがCLI 0.144.6単体版で全shell実行不能だった問題を修復:
  - 原因: 単体インストーラー版codex.exeにsandbox helper(codex-command-runner.exe)が同梱されず、`CreateProcessWithLogonW failed: 2`で失敗
  - 対策: `resolveProviderCommands`がhelper同梱の実体(デスクトップアプリ同梱版)を自動優先。`agent:doctor`にsandbox実働チェックを追加
- リポジトリ直下の野良バイナリ(codex-windows-sandbox-setup.exe)を削除し、`.codex/`と同バイナリをgitignoreへ追加。
- 回帰テスト2件追加(既定順Claude優先/sandbox helper優先解決)。全19件成功、`npm run build`通過。

## パスワードをDBの外へ出さない(2026-07-20)

- 平文パスワードが唯一クラウドへ出ていた経路(DB→シートミラーの企業マスタF列)を遮断:
  - `db-mirror`に`PASSWORD_MASK`(［保護済］)を導入。設定有無だけをシートに示し、実値はDBとローカル資格情報ブローカー(spec13)のみが持つ
  - `db-import-sheet`に再取込ガード(保護マークを実パスワードとして取り込まない)
  - 回帰テスト3件追加(実値がミラーのどこにも出ない/設定済はマスク/未設定は空欄)
- シートの既存平文5社分をF列上書きで即時消し込み、読み戻しで確認。活動ログ記録済み
- 残課題: `company.password`列自体のブローカー移行(列廃止)はOSS公開版までに実施


## DB中心化の残り工事を完了(2026-07-18)

- DB入力6本を接続:
  - メール: 選考差分に加えmail_itemとsubmissionをdaily-syncから反映
  - 会話: agentのみが正本へ書く既存経路
  - 面接: 厳格JSON + db-apply-interviewで面接・人物・人物メモ・プロフィール候補を1トランザクション反映
  - 提出結果: db-apply-submission。statusはtransition()経由
  - カレンダー: external_id/end_at/source_hash付きappointment upsert
  - 企業研究: 根拠URL付きcompany_dossier
- 人物11名、基本情報、顔3枚をDBへ移行。写真本体はPrivate Blob用領域へ分離し、snapshotにはstorage keyだけを掲載。
- meeting_run状態機械を実装し、会議予定ID単位の一回限り実行へ移行。
- inbox/status/profile/people/prep/impactのlocalStorage正本を廃止し、共通 @katazuku/data で認証snapshotを読む構成へ移行。
- トラック照合を包含一致+空欄昇格へ改善し、エクサウィザーズ、八洲電機、LayerX、日本トレカセンター、PKSHAの重複5組を統合。選考トラックは92→87。
- snapshotにpassword/data:imageが無いことを検査。DBテストへ新スキーマ・写真分離・トラック重複防止を追加。
- Windowsタスク5本の登録スクリプトとランナーは用意済み。ただしCodex実行環境からWindows Task Scheduler APIが拒否されたため、OSへの実登録だけ未完。daily-sync/calendar-syncは実走したが、Claudeトークン切れによりConnectionRefusedで停止。トークン復旧後の再実走と本番スマホ確認が外部確認として残る。

## 就活運用の実行 + 面接議事録パイプライン(2026-07-13 午後〜夕)

本人と対話しながら、実運用タスクと新規自動化をまとめて実施:

- **日本トレカセンター【2次】書類選考ESを提出**(HRMOSフォーム、締切7/31に先行)。Q1ガクチカ(LaboRobo)/Q2創作設問「なぜ流行ってると思うか」=オリパ論(結論「信頼できる射幸性」)/Q4「今回のESでのAI活用」を本人承認の上で入力→送信。控えはcareer Gmailへ。
- **選考管理シートを本人所有の複製に切替**(他人テンプレのコピー `1X6z04…` → 本人所有 `1jf6kSy7…`)。コピーは独立ファイルで元所有者に漏れないことを確認。全参照(sheet.ts/CLAUDE.md/katazuku.ps1/INFRA.md)を新IDへ。
  - **新タブ「横断_進行中の選考」を追加**: 夏/冬/本選考の進行中企業をQUERYで1画面集約(不合格・辞退は除外)。
  - **3タブに条件付き書式**(サブエージェント実施): 合格=緑/不合格・辞退=グレー/進行中で次回アクションあり=黄。データ・数式・ログイン列は不変更。
  - ⚠ シートにマイページID/パスワードが平文保存されている箇所あり → 本人にパスワードマネージャへの移行を提案済み。
- **既存リソース台帳 `docs/INFRA.md` を新設 + CLAUDE.mdに「新規クラウドリソースを作る前にINFRAを見て再利用」ルール**追加(GCPプロジェクトを重複作成した反省から。既存プロジェクト`katazuku`にサービスアカウント`katazuku-sync@…`を作成、鍵DL・シート共有は本人操作で保留)。
- **面接議事録パイプラインMVPを新設**(`scripts/interview-digest.ps1` + `interview-digest-prompt.md`): 音声ファイル→**voiceboxのローカルWhisperで文字起こし**→`interview-notes.local.md`へ構造化追記→**今後への示唆**(志望動機反映/次選考対策/フォロー/懸念/self-wiki更新提案)まで。完全ローカル/サブスク内・追加課金なし。録音の自動キャプチャ(meeting-opener連携)は次段。
- **voicebox復旧**: MCPサーバー(voicebox-server)が未起動でツール接続失敗していた→voicebox.exe再起動でポート17493復活・再接続。録音の実地テストは次の面接時に実施予定。
- 令和トラベル カジュアル面談(宮越さん)の生メモを `interview-notes.local.md` に構造化保存(志望動機の芯を抽出)。NRIは不合格(ボードは次回同期でクローズ反映)。

## 自動運転の論点整理 + daily-sync巻き添え停止の解消(2026-07-13 午後)

本人指示「就活の自動運転が実現できるための論点整理を行い、優先度が高いものから取り組む」に対応。
2エージェントで現状棚卸し(自動化カバレッジ)とGmail実データのtoil分析を行い、診断→修正まで実施。

- **診断の核心**: 無人で本当に回っているのは mail-watch と meeting-opener の2つだけ。本命の毎朝バッチ
  daily-sync は `status/service-account.json` 不在で**丸ごと空回り**していた(手順1がハードゲートで、
  鍵が要らない受信整理・締切抽出・Inbox取込まで巻き添えでスキップ)。実ログ `logs/sync-*.log` で確認。
- **修正: `scripts/daily-sync-prompt.md` を全工程停止しない設計へ**。鍵が要るのはシート書込(手順5〜6)
  だけに限定し、メール取得・分類・締切/日程抽出・Inbox取込・受信整理は鍵無しでも必ず走らせる。
- **故障検知を完了センチネル方式へ**(`daily-sync.ps1`)。プロンプト末尾の `=== daily-sync 完了 ===` の
  有無だけで判定し、鍵不在による部分スキップ(=正常)を故障と誤報告しないようにした。→ **要初回実走確認**(明朝08:23)。
- **論点整理ドキュメント新設 `docs/AUTOPILOT-RONTEN.md`**: 就活を4層(L0本人固有/L1定型往復/L2情報整理/
  L3監視防御)に分け、toilの実態(受信の8〜9割が宣伝、実害=ベイン欠席)、ブロッカーの主体別仕分け、優先度を整理。
- **mail-watch に WakeToRun 追加**(`register-mail-watch.ps1`): スケジュール時刻にスリープからPCを起こす。
  ただし現登録タスクはログオントリガー未反映のまま → **要管理者で再登録**。
- **三井物産 "志"ワークショップ2026 ES(締切7/15 10:00)**: マイページはログイン画面(認証は本人)。
  段取りメモ `chrome-prompts/mitsui-workshop-2026.local.md` に コース推奨・ES方針を用意。本人ログイン後にES代行可。
- **本人依頼リスト**: ①SA鍵配置(最短の一手)②mail-watch管理者再登録 ③OAuth本番公開 ④三井物産ログイン。

## 自律メール対応ループ「mail-watch」運用開始(2026-07-13)

本人の指示「メール対応、AIが自律的に動く仕組みを構築して運用開始」に対応。
これで自動運転は「毎時の見張り(mail-watch)→毎朝のバッチ(daily-sync 8:23)→朝のまとめ(asa 9:00)→
会議URL自動オープン(meeting-opener)→クラウド毎時見張り(claude.ai routine)」の5層になった。

- **新設: `scripts/mail-watch.ps1` + `mail-watch-prompt.md` + `register-mail-watch.ps1`**
  - タスクスケジューラ `katazuku-mail-watch`(毎日07:15〜22:15、1時間おき、headless claude -p)
  - 未読を見張り、緊急(面接確定・日程調整・選考結果・提出依頼・24h以内締切)だけ対応:
    返信下書き作成(自動送信は絶対にしない)+careerカレンダー登録+**Windowsトースト通知**
  - 二重処理防止は `logs/mail-watch-state.json`(処理済みID、最大200件)
  - 故障検知は `logs/alert-mail-watch.txt`(asaの手順00が翌朝報告)。ログは `logs/mail-watch-*.log`(14日で削除)
  - ナビ媒体の宣伝は対象外。迷うものはasaに任せて手を出さない設計
- **初回サイクルを実施して運用開始を確認**: 未読20件を仕分け→緊急1件(アイザックのオフィス訪問誘い)に
  返信下書きを作成、状態ファイル初期化、ボードへ反映。残り19件は宣伝・締切超過で対応不要と判定
- 前日(7/12)までの関連整備: asa手順5.5「選考ボードの実態同期」追加、Inbox要対応の精度改善
  (宣伝・就活外は積まない)、Insightの宣伝除外+同社同日1行化、デザインのsmarthr-ui完全準拠化

## SmartHR化の残骸掃除(2026-07-11 深夜)

本人指摘「全部デザイン差し替えられていない」を受けた仕上げパス:

- `font-display` クラスの使用を全アプリから除去(トークンはエイリアスとして残置)
- Statusカンバン列: 旧デザインの上部アクセントバー(border-t-4)と丸すぎる角を廃止、
  枠線+ライトグレー面のSmartHR様式に。STAGES型からaccentフィールドを削除
- 点線UI(空状態・「+追加」・「+新しい部品を書く」)を実線枠の白カードに統一
- EmailCardの選択リングを墨色→ブルー(OUTLINE)に、トーストをピル型→角丸8pxに
- Inboxキーボードヒント箱・PrepフォームカードをSmartHRの面+罫線様式に

## SmartHRデザイン徹底+共通サイドナビ+実データ化(2026-07-11 夜)

本人フィードバック「SmartHRデザインに則っていない・SaaSらしい共通左メニューがない・実データにしてほしい」への対応。

- **デザイントークン全面差し替え**: 5アプリの `src/index.css` を smarthr-ui の defaultColor と同一値に
  (slate=SmartHRグレー、blue=MAIN #0077c7、red=DANGER #e01e5a、teal=ブランド #00c4cc)。
  しっぽり明朝を廃止しシステムゴシックに統一(`font-display` は互換エイリアス化)
- **共通左サイドナビ `AppNav.tsx`** を新設し5アプリへコピー同期。ホーム/メール/選考管理/今日やること/
  個人マスタ/面接準備の6項目、選択中はブルー、モバイルは下タブバー。各アプリの旧ヘッダー
  (黒角印+katazukuロゴ)はページタイトルバーに簡素化。ランディングにも同デザインのサイドナビを静的実装
- CLAUDE.md のデザイン規約を「帳簿的ミニマリズム」→「SmartHR Design System 準拠」に全面書き換え
- 全ビルド・全checkスクリプト通過
- **実データ化**: 選考管理シート(夏インターンタブ)から最新の取込JSONを作成
  (`status/sheet-import-2026-07-11.json`、gitignore済・ID/パスワード列は除外)。直近の動き
  (ベイン2次面接再調整待ち・ジャフコ2次7/16・PKSHA人事面接7/16・チームラボ提出7/12・
  日本トレカセンター応募済・任天堂パスワード待ち)も反映。Gmail実メールは直近14日50件を取得して
  ルールベース分類済みJSONを生成(`inbox/gmail-import-*.json`)。本番 katazuku.kotalabo.com の
  localStorageに投入してサンプルデータを廃止(デモシードはコードに残るが実データで引っ込む)

## 本番ドメイン公開完了 katazuku.kotalabo.com(2026-07-11)

C1(本番公開)が完了。https://katazuku.kotalabo.com でランディング+5アプリが公開中。

- Vercel プロジェクト `katazuku-shukatsu`(kokotatanアカウント)に `katazuku.kotalabo.com` を追加(Production)
- Cloudflare の kotalabo.com に CNAME レコード追加: `katazuku` → `27257dcb575f0d91.vercel-dns-017.com`(プロキシオフ=DNSのみ、他サブドメインと同方式)
- Vercel側の検証・SSL証明書発行を確認。実機で `/` と `/status/` の表示確認済み(demoシードは匿名化済みサンプルが表示される)
- 注意: 前セッションで別Vercelアカウント(okuyama.k@tsubamelab.com)に誤ログインして404になった。katazukuのデプロイ先は **GitHub連携の kokotatan アカウント**
- 残課題: api/generate-reply.ts の環境変数(ANTHROPIC_API_KEY)をVercelに未設定。設定するまでAI返信下書きはルールベーステンプレートにフォールバック

## 自動運転の故障修理と土台強化(2026-07-10)

棚卸し(3エージェント並列)で判明した実害と修理:

- **【故障】headless自動化がほぼ全滅していた**: `daily-sync.ps1` / `open-meeting-urls.ps1` の
  allowedTools が旧 `mcp__google-workspace__*` のみで、実働コネクタ `mcp__claude_ai_Gmail__*` /
  `mcp__claude_ai_Google_Calendar__*` が許可されておらず、会議URL自動オープンは認証エラーで常時失敗、
  daily-syncも早期終了が頻発(logs/ の実ログで確認)。→ ツール名を両対応化して修理
- **【故障】失敗が誰にも通知されない**: 失敗検知を追加。異常時に `logs/alert-*.txt` を書き、
  asa(朝ルーチン)の冒頭で【自動化の故障】として本人に報告する仕組みに
- シート書き込みに決定的ブレーキ追加: 無人applyで15件超の差分は中止(`--force`で解除)。
  LLMの「妥当なら書く」自己判断に頼らない安全弁
- check-pipeline.ts の型追随、meeting-opener.log のローテーション追加
- エントリー代行の実戦知見を `chrome-prompts/08-browser-entry-knowhow.md` に恒久化(e2r/HRMOS突破法)。
  当日実績: 任天堂イベント用マイページ(パスワード入力のみ本人待ち)、日本トレカセンターRAID応募完了
- ID/パスワードの正本は企業マスタ(選考管理シート)に統合する運用へ(submit.local.md §0.1)
- 個人情報混入防止: `tl-snap-*.md` をgitignoreに追加、既存スナップショットを `tmp/` へ退避

同日追記(夕):
- **spec01完了**: 返信文生成API `api/generate-reply.ts`(Vercel Functions版)を実装。
  claude-haiku-4-5 をfetch直叩き、APIキー未設定/障害時はルールベーステンプレートへフォールバック。
  検証 `inbox/scripts/check-reply-api.ts`(20件)。残りはVercelデプロイ+環境変数設定のみ(C1)
- 締切抽出の単体検証 `inbox/scripts/check-dates.ts` を追加(44件)。24時間猶予・年補正境界・
  改行跨ぎ時刻非紐付け等の壊れやすい挙動を固定
- vercel CLI をグローバルインストール済み(ログインは本人作業)
- specs 02/03 に旧フォルダ名(today/notes→insight/profile)の注記を追加

既知の残課題(次の一手): OAuth同意画面の本番公開確認、SA鍵配置(A3)、Vercel本番デプロイ(C1・
ログインは本人)、MINIPC-SETUP.md の旧コネクタ前提の全面書き直し。

## Google直結MCP(workspace-mcp)乗り換え完了(2026-07-03)

`docs/GOOGLE-MCP-SETUP.md` の全手順を完了。Gmail/カレンダー/Drive/Sheets が対話・headless両方で使えるようになった。

- GCP: プロジェクト作成・API 4つ有効化・OAuth同意画面・デスクトップアプリのOAuthクライアント作成
  (Claude in Chrome 代行。プロンプトは `chrome-prompts/06-gcp-oauth-setup.md` に恒久化)
- `claude mcp add google-workspace --scope user`(uvx workspace-mcp、gmail/calendar/drive/sheets)登録済み・Connected確認済み
- 初回OAuth認証は難航(4回失敗)ののち成功。原因と教訓:
  - headless `claude -p` 経由だと承認前にプロセスが終了しコールバックサーバーが消える
  - ツール連打でリトライすると毎回新しい認証フローが発行され、開いていた承認ページが無効化される
  - 解決: MCPサーバーを1プロセスだけ起動し、認証フローを1回だけ発行して承認まで待つ専用スクリプト
    (scratchpadの一時スクリプト。再認証が必要になったら同じ方式で)+ 承認URLをクリップボード渡し
  - トークン保存先: `~/.google_workspace_mcp/credentials/`。クライアントIDシークレットの控えは `~/credientials/`(綴りはtypoだが本人の置き場)
- 追従修正済み: `scripts/daily-sync.ps1` の allowedTools と `daily-sync-prompt.md` / `asa-prompt.md` のツール名を
  `mcp__google-workspace__*` の実名(search_gmail_messages / get_gmail_thread_content / batch_modify_gmail_message_labels /
  get_events / draft_gmail_message 等)に差し替え。これで受信トレイ整理がheadlessのdaily-syncでも動く
- 残タスク: OAuth同意画面の「本番公開」確認(未公開だとトークン7日失効→週1再認証)、SA鍵配置(シート書き戻し)、
  クラウド見張りルーチンの縮小

## ✅ 朝のまとめルーチン「katazuku asa」(2026-07-02稼働開始)

背景: 通知は心理的に無視されるため、「気づかせる」設計から「まとめて渡す」設計へ反転。
システムが先に作業(返信下書き・カレンダー登録・シート突合・面接prep)を終わらせ、
本人にはきょうやることを最大3件だけ提示する。無視しても翌朝また出る(自己修復)。

- 本体: `scripts/asa-prompt.md`(旧 inbox-triage-prompt.md を吸収・拡張)。主な追加:
  - 要返信メールはGmail下書きまで自動作成(下書きツールが無い環境ではコピー可能な返信文を提示。自動送信は絶対にしない)
  - 締切はカレンダーに30〜60分の「作業ブロック」として仮置き登録
  - 選考管理シートと突合し「締切7日以内なのに未出願」の企業を検出(エントリーし忘れ対策)
  - 48時間以内に面接があればprepパック(想定質問・回答素材・逆質問)を生成しイベント説明欄に追記
  - 締切48時間以内の未着手タスクは督促でなく成果物ドラフト(個人マスタ§8の部品から)を出す
- 起動: `katazuku asa`(`katazuku inbox` も同じルーチン)。対話セッションなので返事で続きが進む
- 自動起動: タスクスケジューラ `katazuku-asa`(毎朝9:00、PCが寝ていれば次に使える時。登録スクリプト `scripts/register-asa.ps1`、解除は `Unregister-ScheduledTask -TaskName 'katazuku-asa'`)
- 注意: `.ps1` はBOM付きUTF-8必須(PowerShell 5.1がBOM無しをShift-JIS誤読する)

### 同日追記(2026-07-02 環境整備)

- PowerShellプロファイルに `katazuku` 関数を登録(未登録で `katazuku asa` が動かなかった)
- **daily-syncをタスクスケジューラに登録**(`katazuku-daily-sync`、毎朝8:23。登録スクリプト `scripts/register-daily-sync.ps1`)。
  未登録のまま「毎朝自動実行」と書かれていたので実は一度も回っていなかった
- **重要な発見: ユーザー環境変数に無効な `ANTHROPIC_API_KEY` が残っていて、claude.aiコネクタ(Gmail/カレンダー/Drive)を
  全セッションで無効化していた** → 削除済み(キーは無効だったため退避なし。他ツールで使っていた場合はコンソールから再発行)
- headless(`claude -p`)ではキー削除後もclaude.aiコネクタは載らない(実測。MINIPC-SETUPのトラブルシュート記載どおり)。
  よって daily-sync のGmail処理はheadlessでは動かず、gracefulにスキップされる。対策として**受信トレイ整理(旧daily-sync手順8)を
  asa-prompt の手順8に吸収**(対話セッションはコネクタが使える前提)
- GitHub: gh認証は実は済んでいた。未pushだった21コミットをpush済み(リポジトリはprivate確認済み)
- **asa実行結果(2026-07-02)**: このセッションでもGmail/カレンダー/Driveコネクタは未接続(ToolSearchでも見つからず)。
  さらにChrome拡張も「OAuthトークンが別のclaude.aiアカウント」エラーで接続不可 —
  `CLAUDE_CODE_OAUTH_TOKEN` が環境変数に残っている可能性(要確認)。メール取得手段ゼロのため全手順スキップ
- **方針転換(2026-07-03)**: claude.aiコネクタは追わず、**Google直結MCP(workspace-mcp)に乗り換える**。
  手順書: `docs/GOOGLE-MCP-SETUP.md`。これで対話/headless両対応になり、daily-syncのGmail処理も復活する。
  ブロッカー: Chrome拡張が別のclaude.aiアカウントでログインしていてブラウザ代行操作が不可
  (本人が拡張を laboauto12 に切り替えたらGCP設定を代行実施)
- 用語修正: 本人向け出力の固い言葉(「Yes/No」等)をやめ「きょうやること(最大3件)」に統一
- 残タスク: Chrome拡張のアカウント切替(本人)→ GCPでOAuthクライアント作成+API有効化(代行可)→
  `claude mcp add google-workspace` → daily-sync.ps1のallowedTools差し替え / SA鍵配置(シート書き戻し) /
  クラウド見張りルーチンを「24時間以内の緊急のみ通知」に縮小(claude.ai/code/routines)

## 次回再開メモ(2026-06-13セッション終了時点)

このセッションでやったこと(成果物はすべてgitignore対象の個人ファイル。コード変更なし):
- 個人マスタ `chrome-prompts/submit.local.md` が実戦完成:
  - §4 緊急連絡先の電話番号を記入済み
  - §8 ガクチカ① LaboRobo 4段(実測196/400/391/777字)+ ガクチカ② 生徒会デジタル化 3段(実測400/501/835字)
  - §10 ファイル類は「マスタ管理しない。要求されたら停止して本人対応」方針を明記(空欄は意図的)
- `profile/profile-export-2026-06-13.json`(7スニペット)作成済み → **Profileアプリへの取込が未実施**
  (`katazuku profile` → インポートで取り込む)

次にやること(優先順):
1. **トヨタ自動車のサマーインターンES**(コニック・プロとは別企業。マイページ toyota-saiyo.snar.jp):
   5/21にマイページ内メッセージ通知あり。〆切はメールに記載なし→マイページで要確認。
   ES提出は `katazuku submit` で。**技術系ESの定番「研究概要」素材が§8に未整備** —
   聞かれたらエージェントは停止するので、研究テーマを聞いて200/400字版を§8に追加するのが先回り
2. ガクチカ③の枠(任意。①②で大半カバー済み)
3. インフラ系の積み残し: gh auth login(GitHub push)、GCPサービスアカウント鍵
   (`status/service-account.json` 未配置→毎朝同期のシート書き込みが不活性)、Vercelデプロイ+DNS
4. specs/06(interview)・07(people) は未実装(仕様書あり、/goal渡し可)

ユーザー対応中(開発タスクではない): グッドパッチ2daysインターン(6/13-14当日)、トヨタES提出

## 命名統一(2026-06-13)

READMEの当初構想に合わせてフォルダ・URLを改名: pipeline→status / today→insight / notes→profile。
localStorageキー(katazuku-pipeline/companies, katazuku-notes/snippets)とinbox/src/lib/pipeline.tsの
ファイル名は既存データ互換のため旧称のまま。統一コマンドは scripts/katazuku.ps1 (katazuku <動詞>)。

## 引き継ぎ(2026-06-12〜)

開発はClaude Fable以外のAI(Opus / Codex / GitHub Copilot)へ引き継ぎ。
- 共通規約: `CLAUDE.md`(Claude Code系) / `AGENTS.md`(Codex) / `.github/copilot-instructions.md`(Copilot)
- 次の実装は `docs/specs/01〜04` の順(01: 返信生成API → 02: Today → 03: Notes → 04: Prep)
- 注意: `inbox/src/lib/reply.ts` は `/api/generate-reply` 前提に変更済みだが**サーバー未実装**。
  Spec 01 を最初にやらないと返信モーダルはエラーになる
- 未読メール掃除の途中状態: 古い宣伝900件+α処理済み、残りは継続要(手順は scripts/daily-sync-prompt.md と同様)
**ユーザー向けの進捗一覧はGoogleスプレッドシートで管理**: https://docs.google.com/spreadsheets/d/1dzwnLLRtMJDHcKemJzcGHSqsvkKbeKFC9uXfuM9rqXg
(careerアカウントのドライブ。このmdはリポジトリ内の開発者向け詳細メモ)

## 全体構成

```
katazuku.kotalabo.com          → landing/ (プロダクト一覧トップ)
katazuku.kotalabo.com/inbox/   → inbox/   (メール見逃しゼロ・AI返信生成つき) 完成
katazuku.kotalabo.com/status/  → status/  (選考管理ボード=旧pipeline)        完成
katazuku.kotalabo.com/insight/ → insight/ (今日やること横断=旧today)         完成 (2026-06-12, spec02)
katazuku.kotalabo.com/profile/ → profile/ (ES部品庫=旧notes)                完成 (2026-06-12, spec03)
katazuku.kotalabo.com/prep/    → prep/    (面接振り返り・直前モード)        完成 (2026-06-12, spec04)
```

新3アプリの検証: `cd today && npx tsx scripts/check-aggregate.ts` / `cd notes && npx tsx scripts/check-count.ts` /
`cd prep && npx tsx scripts/check-prep.ts`。ローカル常時配信は `scripts/serve.ps1`(5アプリ、AI返信生成はinboxのpreviewに同梱)。

ビルド: ルートで `npm run build` → `dist/` を組み立て(`scripts/assemble.mjs`)
デプロイ: ルートから `vercel --prod`(`vercel.json` 設定済み)→ 未実施(vercel CLI未インストール・未ログイン)
ドメイン: katazuku.kotalabo.com 予定(DNS設定未実施: CNAME `katazuku` → `cname.vercel-dns.com`)

## ✅ Katazuku Inbox(完成・ローカル動作確認済み)

就活メールの自動仕分け+締切抽出+要対応キュー。Vite + React 19 + TS + Tailwind v4、バックエンドなし(localStorage)。

- 自動分類: 面接/選考結果/ES・提出タスク/説明会/その他(`inbox/src/lib/classify.ts`)
- 日本語日付・締切抽出: 「6月15日(月) 17:00まで」「2026/6/11」等(`inbox/src/lib/dates.ts`)
- 要対応キュー(締切順)、片付け/スヌーズ/カレンダー登録、J/K/E/Sショートカット、検索、片付け率
- Gmail直接続(クライアントサイドOAuth、要クライアントID)+ JSONインポート/エクスポート
- 実メール検証済み: 直近50件で分類テスト→誤分類5件を修正(検証: `cd inbox && npx tsx scripts/check-classify.ts`)
- **具体アクション抽出(2026-06-12追加)**: 「要対応」だけでなく何をすべきか(`inbox/src/lib/actions.ts`)。やることリスト(日程回答/ES提出/課題提出/適性検査受検/イベント予約 等)をカードにチップ表示し、実行先URL(フォーム・マイページ)を「🔗 フォームを開く」ボタンに。URL選定は直前文脈のアクション語を重視し配信停止系を除外。検証: `cd inbox && npx tsx scripts/check-actions.ts`(10ケース)。Pipeline連携のnextActionにもやることリストが流れる
- **Pipeline連携(2026-06-12追加)**: メールカードの「📌 選考ボードへ」でPipelineに企業を追加・更新(`inbox/src/lib/pipeline.ts`)。同一オリジンのlocalStorage(`katazuku-pipeline/companies`)経由。表記ゆれ(株式会社の有無等)を吸収して既存企業は更新、ステージは前進方向のみ(内定/終了は不変)。検証: `cd inbox && npx tsx scripts/check-pipeline.ts`(9ケース通過)。※devでは両アプリのポートが違うため連携は本番ビルド(同一オリジン)でのみ動作
- 実メールデータ: `inbox/gmail-import-2026-06-11.json`(gitignore済・個人情報)→ アプリの設定→インポートで取込

### 未対応(Inbox)
- デザインパス: codex product design プラグインに任せる予定(未インストール)
- 本番でGmail直接続を使う場合: OAuthクライアントIDの承認済みオリジンに https://katazuku.kotalabo.com を追加
- コミット未実施(ベースライン未固定)

## ✅ メール見張りクラウドルーチン(稼働開始)

12時間ごと(JST 09:07 / 21:07)にクラウドでGmailをチェックし、重要メール(面接・締切・選考結果等)だけ通知。

- ルーチンID: `trig_01LE26rJ6RL3FuzU8TBDiNib`(claude.ai/code/routines で管理・削除)
- モデル: claude-haiku-4-5 / cron: `7 0,12 * * *`(UTC = JST 09:07/21:07) / Gmail MCPコネクタ接続済み
- 通知済み管理: Gmailラベル `katazuku-notified` で二重通知防止
- 2026-06-11T11:00Z以前のメールは移行措置で通知対象外
- 注意: クラウド環境にPushNotificationが無い場合は実行結果の冒頭に通知文を書く設計。初回実行の結果要確認
- ローカル版の遺産: `scripts/notify-discord.mjs`(Discord Webhook送信、未使用)、`notify-state.json`(ローカルループ用、クラウド版では不使用)

## ✅ Katazuku Pipeline(選考管理ボード)— 完成・ビルド検証済み

企業ごとの選考ステータスをカンバンで管理(`pipeline/`、/pipeline/ で配信)。

- 6ステージ: 気になる/エントリー済み/ES・テスト/面接・面談/内定/終了
- HTML5ドラッグ&ドロップでステージ移動、カードクリックで編集モーダル(企業名・職種・次のアクション・期限・メモ)
- 期限バッジ(期限切れ/今日/あと◯日)、列内は締切が近い順に自動ソート
- 初期データは実メールから判明した選考状況9社(PKSHA面接再調整・LayerX課題6/29・タイミー面談・ネクストビート6/12締切・博報堂6/25・農林中金6/15・JT・SMBC・ソニー)
- localStorage永続化(`katazuku-pipeline/companies`)
- **Inbox連携(2026-06-12完了)**: Inboxの「選考ボードへ」ボタンから企業を受け取る。`katazuku-pipeline/seeded` フラグでInboxが先に書き込んでも初期9社が消えない。storageイベント購読で別タブからの追加が開いたまま反映される
- **選考管理シート取込(2026-06-12完了)**: Googleスプレッドシート「選考管理シート_奥山彪太郎」(Drive MCPで読込)をGUI化。
  - ステージに「🎫 インターン合格」を新設(サマー合格は内定と別扱い)、カードに業界・志望度バッジ、編集モーダルにマイページURL(開くボタン付き)を追加
  - ヘッダーに JSONインポート/エクスポート。インポートは既存カードを壊さないマージ(stage/nextAction/nextDate は維持、空欄のみ補完、メモは追記)。名寄せは表記ゆれ吸収+短名は完全一致(`pipeline/src/lib/importer.ts`)
  - シート変換済みデータ: `pipeline/sheet-import-2026-06-12.json`(gitignore済。**ID/パスワード列は意図的に除外**)→ アプリの「⬆ インポート」で取込むと初期9社+新規107社=116社
  - 検証: `cd pipeline && npx tsx scripts/check-import.ts`(12ケース、実データの名寄せ衝突チェック込み)
- **シート書き戻し(2026-06-12完了)**: ヘッダーの「📤 シートに反映」でボード→選考管理シートへ同期(`pipeline/src/lib/sheet.ts` + `SheetSyncModal`)。
  - 方式: クライアントサイドOAuth(GIS、Inboxと同方式)+ Google Sheets API values:batchUpdate。**要: ユーザーのOAuthクライアントID + Sheets API有効化**(クライアントIDとシートIDはlocalStorageに保存、デフォルトIDは実シート)
  - 書く列: 出願状況/次回アクション/〆切。業界・志望度は空欄のみ補完。**合格/不合格/辞退は上書きしない**(合格の自動集計数式を守る)。メモ欄・選考①〜④・提出済・残り日数(数式)は不可侵。シートに無い企業は表の空き行に追記
  - 書き込み前に差分プレビュー(更新/追記の企業一覧)を出して確認してから実行
  - 検証: `cd pipeline && npx tsx scripts/check-sheet.ts`(23ケース: 2段ヘッダ検出・全角カッコ名寄せ・別表不可侵など)
  - 名寄せはNFKC正規化を追加(全角カッコ対応)。Inbox側 `lib/pipeline.ts` も同一ロジックに更新

- **シート書き戻し(サービスアカウント版CLI)**: `pipeline/scripts/sheet-sync.ts`。Claude Code/ターミナルから直接書き込める(ブラウザOAuth不要)。Pipelineの「⬇ エクスポート」JSONを渡す。デフォルトdry-run、`--apply`で書込。鍵は `pipeline/service-account.json`(gitignore済、環境変数 `GOOGLE_SA_KEY` で変更可)。書込ルールは `lib/sheet.ts` をアプリと共用
  - 準備: GCPでSheets API有効化→サービスアカウント作成→JSONキー保存→シートをSAメールに編集者で共有
  - 背景: claude.aiのDrive MCPコネクタにはセル更新ツールがなく、MCPだけでは書き戻し不可

### 未対応(Pipeline)
- デザインパスはInboxと同様プラグイン待ち
- シート書き戻しの実機テスト(サービスアカウント鍵 or OAuthクライアントID作成後)

## 🕗 毎日のシート自動同期(miniPC運用予定)

メール→選考管理シートの無人同期。実装済み・**鍵未作成のため未稼働**。

- `scripts/daily-sync.ps1`(タスクスケジューラから起動)→ `claude -p` + `scripts/daily-sync-prompt.md` → Gmail分析 → `pipeline/scripts/sheet-sync.ts` で書込
- 移行手順は `docs/MINIPC-SETUP.md` に一本化(クローン→秘密ファイルコピー→鍵作成→schtasks登録→動作確認)
- 運用はminiPC予定。ノートPCでも同じschtasksコマンドで登録可
- 注意: リポジトリにGitHubリモート未設定(miniPCへは `gh repo create --private --source . --push` か直接コピー)

## ユーザー情報・経緯メモ

- 奥山彪太郎さん、東北大学大学院・28卒。就活用Gmail: okuyama.kotaro.career@gmail.com(MCP接続済み)
- 直近14日で201通。PKSHA面接遅刻→再調整待ち、ネクストビート/トヨタコニック6/12締切等は把握済み
- 方針: 同一ドメイン配下にプロダクトを並べる / 通知はDiscordより内蔵プッシュ優先 / AI処理はHaikuで十分(現状アプリはルールベースでLLM不使用)

## 2026-09-08 角丸・枠・配色の修正

本人の指摘を受け、個人GUIを白地と無彩色へ変更。共通CSSをshared/src/app.cssへ集約し、情報カードの外枠と大きな角丸を削減。メールは「すべて／要対応」の絞り込みと行区切り、更新日時は見出し下へ移動。企業研究・人物詳細・選考・基本情報・活動記録も外枠を減らした。

- 公開先: https://katazuku-app.kotalabo.com/
- Worker: katazuku-shukatsu
- 最終版: 637e84ff-76ab-4a30-a552-90f9612b11f3
- npm run build（全チェック含む）、cloudflare:check成功。
- PCと390px幅でメールの空・絞り込み・更新履歴・認証、企業切替とロゴ、人物の全会話履歴・一覧への復帰、ナビを確認。各画面の横はみ出しなし。
- 本番のホーム＋8画面とSW・ロゴ等がローカル最終版と一致。データ・写真は未認証401、本人認証200、データno-store。静的配信物の氏名・連絡先・秘密値等の検査で検出なし。
- 共通URLから各自のCloudflareへ接続し、PCで対話型AIを起動する構成をdocs/OSS-COMMON-APP-20260908.mdに記載。この新機能は未実装。現在の単一利用者の合言葉認証は維持。
- 公開HP、OSSリポジトリ、正本DB、同期の接続先は今回変更していない。

## 2026-09-08 細部の確認と本番反映

更新ボタンの統一、長文閲覧中の一覧固定、出典の開閉表示、長い氏名の折り返し、写真の収まり、入力寸法、薄い日付の文字色、ホームと各画面のメニューの統一を実施。

- Worker版: 9831566c-6bc0-4b8d-a4bb-c8970bafc73d
- npm run build（全チェック含む）とcloudflare:check成功。
- PC・390px・320px幅で確認。1.2秒の通信遅延中も更新ボタン幅80pxと本文を維持、503後も本文が残り再更新できる。PCで1085pxスクロールしても企業一覧が上32pxに残る。320px時の入力は44px高・16px文字で横はみ出しなし。
- 本番9画面・SW・ロゴ等がローカル最終版と一致。未認証のデータ・写真は401、本人認証200。公開配信ファイル検査で氏名・秘密値等の検出なし。
- 検証ログ: logs/ui-details-build.local.txt / logs/ui-details-cloudflare.local.txt / logs/ui-details-verification.local.json
