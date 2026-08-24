# katazuku 現行アーキテクチャ

最終更新: 2026-08-25
対象: 現在のprivate運用
状態: 現行実装を説明する上位設計。個別の業務規則は各Specを正本とする。

## 1. この文書の役割

katazukuは、就職活動に伴う情報収集、予定管理、選考状態の更新、応募準備、面接記録、企業研究を自動運転する単一ユーザー向けの個人システムである。本人が担当するのは「考える・受ける・認証する・決める」であり、それ以外の反復作業をAgentと決定論的なExecutorが担当する。

この文書は、複数のSpecと実装へ分散している現在の設計を、次の観点から一つに束ねる。

- 何が原本で、何が正本で、何が派生物か
- Agent、Executor、本人、外部サービスの責務境界
- Bronze / Silver / Goldのデータ階層
- 業務データ、実行制御、配信、機密情報の分離
- 再実行、冪等性、承認、失敗復旧の原則
- 現在実装済みの範囲と、まだ統一されていない範囲

本書は個別Specを置き換えない。矛盾がある場合は、業務規則は個別Specとコード、インフラの実在情報は[INFRA.md](./INFRA.md)を優先し、本書を更新する。

## 2. 目的と非目的

### 目的

1. 本人が手作業で情報を追跡しなくても、正しい次の行動が分かるようにする。
2. 取得した事実と根拠を失わず、モデルが変わっても同じ業務規則で処理する。
3. 同期不全や結果不明を成功扱いせず、外部への二重送信・二重予約を防ぐ。
4. 蓄積した企業、人物、面接、選考の情報を再利用し、ブリーフィングと意思決定の質を上げる。
5. ノートPCとMiniPCの役割を分け、正本DBと本人認証の境界を守る。

### 非目的

- 複数ユーザー向けSaaSとしての提供
- Webテスト、コーディングテスト、面接など本人が受けるべき選考の代行
- モデルに自由なSQL、自由な外部送信、包括的な永続権限を与えること
- Google Sheets、ブラウザのlocalStorage、会話履歴を正本にすること
- Bronze / Silver / Goldごとに、直ちに別製品や別DBを導入すること

メダリオンは論理的な責務分離であり、物理ストレージを三つに分けること自体を目的にしない。

## 3. システム全体像

```mermaid
flowchart LR
    subgraph Sources[外部原本・観測元]
        Gmail[Gmail]
        Calendar[Google Calendar]
        Web[企業公式情報・応募サイト]
        Media[面接録音・画面記録]
        User[本人との会話・本人判断]
    end

    subgraph Bronze[Bronze: 原本・取得成果物]
        Raw[ローカル原本・取得JSON・実行artifact]
    end

    subgraph Control[Control Plane]
        Contract[Workflow Contract]
        Controller[Workflow Controller]
        Runner[Agent Runner]
        Agent[交換可能なAgent]
        Executor[Deterministic Executor]
        Ledger[(workflow-runtime.local.db)]
    end

    subgraph Silver[Silver: 正規化された業務状態]
        DB[(data/katazuku.db)]
    end

    subgraph Gold[Gold: 用途別の派生物]
        Snapshot[snapshot.json]
        Brief[agenda・企業/面接ブリーフ]
        Mirror[Google Sheets mirror]
    end

    subgraph Delivery[Delivery Plane]
        Blob[Vercel Private Blob]
        API[/api/data・/api/photo]
        Apps[8アプリ・PWA]
        Notify[メール・Web Push]
    end

    Gmail --> Raw
    Calendar --> Raw
    Web --> Raw
    Media --> Raw
    User --> Contract
    Raw --> Agent
    Contract --> Controller
    Controller --> Runner --> Agent
    Agent -->|Schema準拠のProposal| Controller
    Controller --> Executor
    Executor --> DB
    Controller --> Ledger
    DB --> Snapshot
    DB --> Brief
    DB --> Mirror
    Snapshot --> Blob --> API --> Apps
    Brief --> Notify
    Executor -->|承認済みActionのみ| Sources
```

この図の矢印は責務上の流れを示す。現状では、すべての入力に統一されたBronze保存処理があるわけではない。外部サービスが原本を保持したまま、必要な事実だけをSilverへ取り込む経路もある。

## 4. 五つの論理領域

katazukuは、データの成熟度を表す三層と、それを安全に動かす二つの平面に分ける。

| 領域 | 責務 | 現在の主な実体 | 正本性 |
|---|---|---|---|
| Bronze | 取得した原本、観測結果、再処理用artifactを保つ | Gmail・Calendar等の外部原本、`logs/`、`logs/interviews/`、gitignoreされた取得JSON・音声・一時成果物 | 外部原本または再処理材料。内部業務状態の正本ではない |
| Silver | 企業、選考、予定、人物、面接などを正規化し、根拠付きで保持する | `data/katazuku.db` | katazuku内部の業務状態の唯一の正本 |
| Gold | 具体的な画面、通知、質問、判断用途に合わせて投影・集計する | `snapshot.json`、agenda、面接準備、企業別表示、Sheet mirror | 再生成可能な派生物。編集元にしない |
| Control Plane | 工程、権限、Schema、承認、冪等性、provider切替、監査を制御する | `sync/workflows/`、`sync/schemas/`、Agent runner、Executor、`logs/workflow-runtime.local.db` | 実行状態の台帳。業務事実の正本ではない |
| Private Plane | 秘密・高機微データを、通常のsnapshotやgitから分離する | `.env`、credential broker、`data/private/photos`、住所・移動履歴、`*.local.*`、`logs/` | データごとに正本が異なる。配信禁止または限定配信 |

### 4.1 「外部原本」と「内部正本」の違い

`data/katazuku.db`は、katazukuが現在どう認識しているかを示す唯一の正本である。ただし、Gmailのメール原文、Google Calendarのイベント、企業サイトの送信結果、面接録音そのものを置き換える不変原本ではない。

- 外部サービスまたは原本ファイル: 何が実際に届いた、表示された、録音されたかの根拠
- 正本DB: その根拠から確定した、現在の企業・選考・予定・人物・提出状態
- eventと`source_ref`: なぜその状態になったかを追跡する接続点
- snapshotと画面: 現在の正本を用途別に見せる読み取りモデル

したがって「DBが正本」は「原文を捨ててよい」という意味ではない。Silverの抽出規則を変えて再生成したい情報は、Bronzeに原本または再取得可能なstable refを残す。

## 5. メダリオン各層の設計

### 5.1 Bronze: 原本・観測層

Bronzeの責務は、モデルや抽出ロジックに依存しない形で、後から事実を確認または再処理できるようにすることである。

原則:

- 原本は可能な限り変更せず保存する。
- 取得時刻、取得元、外部ID、content hash、対象アカウントを結び付ける。
- 秘密や個人情報を含むため、原則ローカルか認証済みprivate storageに置く。
- 原本の全文をworkflow台帳、活動ログ、git、snapshotへ複製しない。
- 外部サービスから確実に再取得できる場合は、全文複製ではなくstable refとhashを保持してよい。

現在の状態:

| 入力 | 現在の原本・再処理材料 | 状態 |
|---|---|---|
| メール | Gmailのmessage/thread、gitignoreされた抽出artifact | 外部原本あり。統一されたローカルraw archiveは未整備 |
| 会話 | 対話履歴、本人が管理するlocal台帳 | 専用のBronze入口と保存規約は未整備 |
| 面接 | 録音・録画、文字起こし、`logs/interviews/`、画面記録 | 原本保存あり。manifestと保存期間は未統一 |
| 提出結果 | 応募サイト、確認メール、ローカル台帳、submission入力JSON | 複数の根拠に分散 |
| カレンダー | Google Calendar eventと同期時の取得結果 | 外部原本あり。同期状態と投影は構造化済み |
| 企業研究 | 公式ページ・IR等のURL、調査artifact、dossierのsources | 出典は保持。取得本文の保存規約は未統一 |

Bronzeは現行設計で最も不均一な層である。新しい機能で独自フォルダを増やす前に、共通manifestと保存規約を定める必要がある。

### 5.2 Silver: 正規化・業務状態層

Silverの物理的中心は`data/katazuku.db`である。正本DBの書き手はAgentそのものではなく、Agentの提案を検証する専用apply関数または決定論的Executorである。会話からの更新も同じ業務規則を通す。

主なドメイン:

| ドメイン | 主なテーブル | 不変条件 |
|---|---|---|
| 企業・選考 | `company`、`company_alias`、`selection`、`event`、`pending_review` | 状態更新は`transition()`、怪しい名寄せは保留 |
| 予定・空き | `appointment`、`schedule_block`、`source_sync_state` | `unknown`を空き扱いしない |
| 人物・面接 | `person`、`person_note`、`appointment_person`、`interview_note`、`meeting_run` | 確定情報と候補を分離し、根拠refを残す |
| 自己情報 | `profile_basic`、`profile_suggestion` | 面接抽出で確定情報を上書きしない |
| メール・提出・研究 | `mail_item`、`submission`、`company_dossier` | 外部IDまたはsource refで冪等化 |
| 応募 | `application_run`、`application_event`、`application_material`、`web_assessment` | 承認ゲートと状態機械を迂回しない |
| 移動 | `place`、`mobility_profile`、`appointment_mobility`、`route_estimate`、`travel_segment` | 住所・具体的移動履歴をsnapshotへ出さない |

Silver内にある`company_dossier`は、用途別レポートに近い情報でも、企業に紐づく調査済み知識と出典を一貫して更新するため正本DBに置く。そこから面接ごとに作るブリーフやUI投影がGoldになる。

### 5.3 Gold: 用途別提供層

Goldは正本DBから再生成できる読み取りモデルである。Goldを直接編集してSilverへ逆流させない。

| Gold成果物 | 生成元 | 消費者 | 更新契機 |
|---|---|---|---|
| `data/snapshot.json` | 正本DB、活動ログ | `/api/data`、8アプリ | DB書き込み後 |
| Vercel Blob `snapshot.json` | ローカルsnapshot | スマホ・PWA・各アプリ | `db-snapshot.ts`のpush |
| Google Sheets mirror | 正本DB | 人間の一覧閲覧、バックアップ | mirror workflow |
| agenda / 朝・夜のbrief | 正本DB、同期状態、alert | 本人へのメール・通知 | 定常タスク |
| 企業・面接準備表示 | dossier、人物、面接、予定 | `prep`、`board`等 | snapshot更新 |
| カレンダーoutbox | 正本DBの未連携appointment | Calendar Executor | 外部反映前 |

Goldの鮮度はSilverの正しさと別問題である。DB commit後にpushが失敗してもSilverは更新済みであり、画面だけが遅れる。この場合、DBを巻き戻さず配信を再試行する。

現行`db-snapshot.ts`はローカル生成、DB整合性確認、日次バックアップ、クラウドpushを一つのコマンドで行う。push接続失敗は警告として扱うため、workflowの完了判定では「Silver更新済み」「ローカルGold生成済み」「クラウド配信済み」を区別する必要がある。

## 6. 六つの入力から出力まで

| 入力 | 観測・抽出 | 決定論的入口 | Silverへの主な反映 | 主な冪等キー・根拠 | Goldでの利用 |
|---|---|---|---|---|---|
| メール | Gmail read、厳格JSON抽出 | `daily-sync-apply.ts`、`db-apply-mail.ts`、`db-apply-submission.ts` | 選考、メール、提出、予定候補 | message/thread ref、source ref | inbox、status、agenda |
| 会話 | 本人の明示した事実・修正・判断 | Agentが既存DB関数と専用CLIを使用 | 全ドメイン | 会話内の明示指示、event ref | 全画面・次回会話 |
| 面接録音 | 音声処理、文字起こし、厳格JSON | `db-apply-interview.ts` | 面接、人物、人物メモ、プロフィール候補 | meeting run ID / source ref | people、profile、prep |
| 提出結果 | サイト結果、確認メール、本人報告 | `db-apply-submission.ts`、application event | submission、selection、application run | submission/source ref、application event ID | status、impact、agenda |
| カレンダー | Calendar fetch | `db-apply-calendar.ts` | appointment、schedule block、同期状態 | account/calendar/event ID、source hash | agenda、空き判定、会議自動運転 |
| 企業研究 | 一次情報中心の調査と出典付きJSON | `db-apply-research.ts` | company、company dossier | company ID、research source ref | prep、insight、事前brief |

入力ごとに抽出方法は異なるが、`観測 → Fact/Proposal化 → Schema検証 → Executor反映 → snapshot → audit`を標準形とする。

## 7. Fact、Proposal、Action

すべての処理対象は、次の三つを混ぜない。

| 種類 | 意味 | 例 | 扱い |
|---|---|---|---|
| Fact | 外部根拠または本人の明示で確認できる事実 | メールID、面接日時、提出結果 | source ref付きでSilverへ保存 |
| Proposal | Agentが構造化・推定した候補 | 企業名寄せ候補、返信案、自己分析候補 | Schema検証し、必要ならpending reviewへ |
| Action | 状態を変える操作 | DB更新、下書き、予約、送信 | Executorが契約、冪等性、承認を検査 |

この分離により、モデルの「もっともらしい推測」が事実として保存されたり、提案文がそのまま第三者へ送られたりすることを防ぐ。

## 8. Control Plane

### 8.1 責務分担

| 実行主体 | 担当 | 担当しないこと |
|---|---|---|
| Trigger | Windowsタスク、CLI、本人操作からrunを開始 | 業務判断、DB直接更新 |
| Workflow Contract | 工程順、owner、capability、Schema、副作用、承認、冪等性を宣言 | provider固有ツール名 |
| Workflow Controller | 契約検証、DB identity固定、状態遷移、承認照合 | 内容の推測 |
| Agent | 読み取り、抽出、分類、要約、Proposal生成 | DB書き込み、第三者確定、自由なSQL |
| Executor | Schemaと業務規則の再検証、DB反映、外部操作、監査 | 根拠のない補完 |
| User | 本人認証、本番選考、方針判断、第三者Actionの承認 | 自動処理の逐次監視 |

### 8.2 標準ワークフロー

```text
prepare
  -> extract      Agent / read-only / strict JSON
  -> validate     Executor / Schema + domain rules
  -> apply        Executor / canonical DB + idempotency
  -> snapshot     Executor / serving projection + backup
  -> audit        Executor / activity log
  -> done
```

Agent工程は`sideEffect: none`でなければならない。第三者への確定操作は、別のUser承認工程と`third-party-commit`工程を持つ。

### 8.3 二つの実行台帳

- `data/katazuku.db`: 業務上何が起きたかを保持する。
- `logs/workflow-runtime.local.db`: どのworkflowのどの工程が、どの入力・契約・DBに対して進んだかを保持する。

実行台帳にメール本文や面接原文を複製しない。業務事実をworkflow台帳から復元しようとせず、逆にprovider失敗や承認状態を業務テーブルへ詰め込まない。

## 9. 正本DBと予定確定の安全境界

正本DBは起動時に絶対パス、`database_id`、role、Schema versionを固定する。

| role | 用途 | 外部確定 |
|---|---|---|
| `canonical` | MiniPC上の唯一の正本 | 条件を満たす場合だけ可 |
| `replica` | 閲覧、バックアップ、復旧確認 | 不可 |
| `fixture` | テスト | 不可 |

ノートPCは本人認証・確認・ブラウザ入力を担い、正本DB操作は`notebook-minipc.ps1`等の定められた経路でMiniPCへ依頼する。`.katazuku-satellite`がある端末では、ローカル既定DBを正本として更新することをコードで拒否する。

日程確定直前は、Calendarを再同期し、同じ正本DBに対して三値判定を行う。

- `conflict`: 既知の予定、移動、バッファと衝突する。
- `unknown`: 同期失敗、鮮度切れ、期間外、非canonicalなどで完全性を証明できない。
- `available`: 同期、鮮度、期間、DB role、衝突検査のすべてを満たす。

確定できるのは`state === "available"`、`available === true`、`database.role === "canonical"`が同時に成立する場合だけである。

## 10. 第三者への確定操作

メール送信、応募、フォーム提出、予約確定、取消、変更通知は、次の条件をすべて満たす専用Executorだけが実行する。

1. 宛先、本文、日時、通知内容を含むAction全体を本人へ提示する。
2. canonical JSONのSHA-256で提示内容と承認を結ぶ。
3. 同じ作業内の未消費承認と完全一致することを直前に再確認する。
4. 元スレッド、正本DB、Calendar同期鮮度、重複・送信済み状態を再照合する。
5. 成功を外部状態から確認してから承認を`consumed`にする。

一項目でも変われば再承認する。タイムアウトなどで結果が分からない場合は`unknown`で停止し、確認できるまで再送しない。MFA、CAPTCHA、OAuth同意、本人確認はノートPC側Chromeへ引き継ぐ。

## 11. 再実行、障害、provider切替

| 障害点 | 再実行方針 |
|---|---|
| Agent出力確定前 | 同じ入力とSchemaで別providerへ切替可能 |
| Schema不一致 | 副作用なし。上限付きで再生成可能 |
| DB transaction失敗 | rollbackし、同じ外部キーで再試行可能 |
| DB commit後、snapshot失敗 | DBを戻さずsnapshotを再生成する |
| 外部下書き後 | 外部IDを再取得し、存在確認後に続行する |
| 第三者確定中のtimeout | `unknown`。外部状態をreconcileするまで再実行禁止 |
| 本人認証が必要 | `needs_user`で停止し、本人へ引き継ぐ |

providerは推論の実行役であり、安全規則の所有者ではない。Claude、Codex、local OSSのどれを使っても、同じSchema、transition、承認hash、冪等キーを使用する。

## 12. 配信とプライバシー境界

### 12.1 現在のデータ配置

| データ | ローカル | クラウド配信 | git |
|---|---|---|---|
| 正本SQLite | `data/katazuku.db` | しない | 除外 |
| snapshot | `data/snapshot.json` | Vercel Private Blob | 除外 |
| 人物写真本体 | `data/private/photos` | Private Blob、`/api/photo` | 除外 |
| 住所・緯度経度・具体的移動履歴 | 正本DBのみ | snapshotへ含めない | 除外 |
| schedule block | 正本DBのみ | snapshotへ含めない | 除外 |
| workflow・Agent実行artifact | `logs/`、`*.local.*` | 原則しない | 除外 |
| 認証情報 | `.env`、credential broker、OAuth cache | 対象プロセスへ実行直前に限定提示 | 除外 |

`company`には互換用の`login_id` / `password`列が残っており、snapshot生成時に`password`を明示除外している。新しい資格情報処理はcredential brokerを使用し、互換列を新たな秘密の保存先にしない。

### 12.2 現在認識しているリスク

snapshotはパスワード、画像本体、住所、具体的移動履歴を除外する一方、プロフィール、人物名、人物メモ、面接詳細、メール要約、提出結果、企業研究を含む。Private Blobではあるが、`/api/data`の読み取りは現在、ブラウザに保持する長寿命の単一合言葉と`Access-Control-Allow-Origin: *`に依存する。

したがって、次を明確に区別する。

- 「Private Blobである」こと
- 「snapshotに個人情報が入っていない」こと
- 「利用者・端末・用途ごとに認可されている」こと

現状は一つ目を満たすが、二つ目と三つ目は満たしていない。これは既知の設計判断待ちであり、Goldだから低機微とは扱わない。

通知本文はロック画面へ表示されるため、企業名・個人名・選考詳細を必要以上に含めない。

## 13. 端末と運用トポロジー

| 端末・サービス | 主な責務 |
|---|---|
| MiniPC (`KOKOTATANPC`) | 正本DB、snapshot、定常タスク、バックグラウンド同期、監査 |
| ノートPC | 本人認証、OAuth同意、MFA、CAPTCHA、既存Chrome、確認と手入力 |
| Google Workspace | メール・カレンダーの外部原本、Sheets mirror、通知 |
| Vercel | snapshot・写真の認証API、8アプリとPWAの配信 |
| Cloudflare DNS | `katazuku.kotalabo.com`の名前解決。業務データの正本は置かない |

定常タスクの実在、周期、対象アカウントは[INFRA.md](./INFRA.md)を正本とする。文書に記載があってもWindowsタスクが登録済みとは限らないため、実機状態を確認する。

## 14. 現在の到達点

| 領域 | 状態 | 補足 |
|---|---|---|
| 正本DBと6入力 | 実装済み | 各専用apply入口あり。会話だけ統一Bronze入口がない |
| DB identity / role | 実装済み | replica・fixtureでの外部確定を禁止 |
| Calendar三値判定 | 実装済み | 鮮度、期間、schedule blockを検査 |
| Agent provider切替 | 実装済み | capabilityと副作用状態を考慮 |
| Workflow工程契約 | 部分実装 | `daily-sync`、`third-party-email`から適用中 |
| daily-syncの抽出・apply分離 | DB書込経路は実装済み | 既読化、整理、mirror等にlegacy経路が残る |
| 面接・人物・プロフィール更新 | 実装済み | 原本manifestと保存期間は未統一 |
| 応募・第三者操作 | 安全境界は実装、外部実走を蓄積中 | サイト別adapterとfixtureが増加途上 |
| 移動込み日程調整 | 基礎DBと判定を実装 | 経路adapter、候補スコアリングは発展途上 |
| Goldアプリ配信 | 実装済み | 読み取り認証とsnapshot範囲は要改善判断 |
| Bronze共通管理 | 未統一 | 入力ごとに保存方法、retention、lineage粒度が異なる |

## 15. 設計上の優先課題

### P0: Bronzeの共通規約を決める

実装を移動する前に、原本または再取得参照を記録するmanifestを定義する。最低限、`artifact_id`、`source_type`、`source_ref`、`observed_at`、`content_sha256`、`local/private location`、`retention`、`contains_sensitive_data`、`derived_from`を持たせる。

全文保存が必要な録音・提出結果と、外部再取得で足りるGmail・Calendarを区別する。Bronzeをsnapshotやworkflow台帳へ混ぜない。

### P0: snapshotの認可と収録範囲を決める

現在の利便性を維持するか、機微データをローカル限定APIへ分離するか、短命セッション・端末認証へ移行するかを本人判断で決める。実装前に、各アプリが本当に必要とするフィールドを一覧化する。

同時に、正本DBに残る互換用の資格情報列について、実データの移行完了と参照箇所を確認し、credential broker以外へ秘密が増えない状態を明文化する。

### P0: 残るlegacy workflowを工程契約へ移す

`calendar-sync`、`mail-watch`、`asa`、`interview-digest`を、Agent read-only工程とExecutor副作用工程へ分割する。既読化、ラベル変更、下書き、mirrorを抽出工程から外し、各操作にcapabilityと冪等キーを持たせる。

### P1: lineageを共通化する

テーブルごとの`source_ref`や外部IDは既にある。これをBronze manifestへ接続し、Silverのレコードから「どの原本・どの抽出run・どのSchema versionで生成されたか」を追えるようにする。全面的なイベントソーシングにはせず、重要なFactから段階導入する。

### P1: Goldの契約を明示する

各Gold成果物について、入力、生成コマンド、含めてよい機密区分、鮮度、消費者、失敗時の再生成方法を宣言する。特にsnapshotのローカル生成成功とクラウドpush成功を別状態として監視する。

### P1: 復旧を実証する

日次バックアップが存在するだけでなく、replica roleで復元・整合性検査し、正本へ昇格する手順を演習する。workflow台帳、写真、Bronze原本と正本DBの復旧順序も定める。

### P2: ナレッジ検索をGoldとして追加する

RAGやvector indexは、原本とlineageが整ってから追加する。vector indexを正本にせず、company、person、interview、dossierから再生成可能なGold projectionとして扱う。

## 16. 新機能を追加するときの判断順序

1. 取得元の原本または再取得可能な参照は何か。
2. Bronzeへ何を保存し、何日保持し、どの機密境界に置くか。
3. Silverの既存ドメインへ入るか、新しい業務概念が必要か。
4. Fact、Proposal、Actionのどれか。
5. Agentでなければできない工程はどこか。
6. Executorが強制するSchema、遷移、冪等キー、承認は何か。
7. Goldは誰が何の判断に使い、正本から再生成できるか。
8. 失敗時に`retry`、`reconcile`、`unknown`、`needs_user`のどれになるか。
9. snapshot、git、ログ、通知へ出してよい情報か。
10. 自動試験でどの安全条件を証明するか。

## 17. 守るべき不変条件

1. 内部の業務状態の正本は`data/katazuku.db`一つである。
2. Sheets、Calendar、snapshot、画面、会話履歴から正本へ無検証で逆流させない。
3. DB更新は専用apply、domain関数、`transition()`、transactionを通す。
4. Agentは副作用を持たず、厳格SchemaのProposalを返す。
5. `unknown`を成功または空きとして扱わない。
6. 第三者確定操作は、本人が確認したAction全体と同じhashの場合だけ実行する。
7. 外部確定前に正本DB identity、最新Calendar、重複・完了状態を再照合する。
8. provider切替で承認、冪等性、業務規則を変えない。
9. DB commit後はsnapshotとauditを行い、配信失敗はDB rollbackではなく再配信で直す。
10. 秘密、住所、具体的移動履歴、写真本体、原本全文を通常snapshotへ出さない。
11. Goldとworkflow台帳を業務正本にしない。
12. 原本を保存しない場合は、stable refと再取得可能性を明示する。

## 18. 詳細仕様への導線

| 主題 | 正本ドキュメント |
|---|---|
| DB、6入力、snapshot、名寄せ、遷移 | [Spec 08](./specs/08-data.md) |
| 面接から人物・プロフィール候補への反映 | [Spec 10](./specs/10-auto-update.md) |
| 応募の状態機械と本人境界 | [Spec 11](./specs/11-application-autopilot.md) |
| 移動を含む日程調整 | [Spec 12](./specs/12-mobility.md) |
| 資格情報ブローカー | [Spec 13](./specs/13-local-credential-broker.md) |
| provider切替と障害分類 | [Spec 14](./specs/14-provider-independent-agent-runtime.md) |
| MiniPC / ノートPC移行 | [Spec 15](./specs/15-minipc-migration.md) |
| PWA・Push | [Spec 16](./specs/16-pwa-push.md) |
| Workflow契約、Fact/Proposal/Action、承認hash | [Spec 17](./specs/17-semantic-control.md) |
| 実在するクラウド資源・Windowsタスク | [INFRA.md](./INFRA.md) |
| ノートPCからMiniPCを扱う手順 | [NOTEBOOK-MINIPC-OPERATIONS.md](./NOTEBOOK-MINIPC-OPERATIONS.md) |
| provider運用と自動引き継ぎ | [AGENT-FAILOVER.md](./AGENT-FAILOVER.md) |

## 19. 文書の更新規則

- 本書には「現在の構成と境界」を書き、個別機能の詳細手順や時系列の作業記録を増やしすぎない。
- 新しい正本、外部サービス、定常タスク、配信先を追加したら、本書とINFRAを同時に更新する。
- 新しい業務概念や安全境界は個別Specへ定義し、本書から参照する。
- 実装前の構想は「現在の到達点」と混ぜず、優先課題またはROADMAPへ置く。
- 文書と実装が食い違う場合は、実態を確認し、事故につながる不一致を放置しない。
