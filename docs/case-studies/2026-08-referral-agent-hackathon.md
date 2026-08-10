# Referral Agent ハッカソン振り返り

- 日付: 2026年8月
- 形式: 社内AI Agentハッカソン
- 成果物: React/Viteによる操作可能なデモ
- 結果: 受賞には届かなかった
- 公開ページ: `/projects/referral-agent/`

## 1. 一文で振り返る

評価されたチームは、着眼点だけでなく「どう解くか」「どの技術とデータ構造で作るか」「実際に動くか」を一つの証拠として見せていた。Referral AgentはAmbient Agentの着眼点は評価されたが、課題の実証とプロダクションレベルのVertical Sliceまで届かなかった。

## 2. 課題仮説

出発点は、タレントプールが名前の一覧になり、ファーストコンタクト後の関係が続かないという仮説だった。

当初は「固定周期の未接触検知」を中心にした。しかし調査と対話を通して、日数だけの通知よりも次の問題が重要だと分かった。

- 過去に本気で欲しかった人を、なぜ今もう一度考えるべきか分からない
- 自然に連絡できる社内の接点者がいても、人間関係を採用営業へ変える怖さがある
- 前回成立しなかった理由を覆す、会社・本人・所属企業の変化を記憶だけで追えない
- Whats new と Why you がないと、自然な一通を作れない

本来は「過去に本気で欲しかった中途候補一人を再活性化する」に絞るべきだった。最終デモでは、周期運用、再活性化、候補探索、月次報告、強制措置まで含め、焦点が薄まった。

## 3. 提案したソリューション

Ambient Agentを単独のチャット画面ではなく、普段のSlack・候補者マスタ・Calendar・公開情報の間で静かに動くオーケストレーション層として構想した。

基本原則は次の通り。

1. 許可された情報だけを観測する
2. 会社と候補者の変化が重なった時だけ提案する
3. Why now / Why you と出典を必ず示す
4. 外部送信は人の承認後だけ実行する
5. 結果、編集差分、見送り理由を次の判断へ残す

### Agent構成

#### Company Agent

権限内のSlack、社内Wiki、Calendar、事業・経営更新から `CompanySignal` を生成する。

#### Candidate Context Agent

X、Zenn、GitHub、登壇資料、会社公式、許可済み接点記録を候補者別namespaceへ保存する。本人発言、公開事実、Agentの推測は別フィールドにする。

候補者ごとに専用LLMを作るのではない。共通LLM、候補者別namespace、検索ツール、固定Schema、承認ルールを組み合わせる。

#### Referral Agent

`CompanySignal × CandidateContext` を照合し、Why now、Why you、接点者、同席候補、話題、チャネル、送信文を含む `ReferralPlan` を提案する。

#### Talent Scout Agent

事業インパクトと採用ブリーフから、X、Zenn、GitHub、登壇、会社公式を探索し、公開根拠付きの候補集合を作る。転職意向、思想、性格、センシティブ属性は推測しない。

### 想定ワークフロー

```text
権限内の社内更新
  -> Company Agent
  -> CompanySignal

X / Zenn / GitHub / 登壇 / 許可済み接点
  -> Candidate Context Agent
  -> CandidateContext

CompanySignal x CandidateContext
  -> Referral Agent
  -> Slackで根拠付き提案
  -> 人が編集・承認
  -> X / Calendar / 候補者マスタ
  -> 結果を次回判断へ反映
```

## 4. 実際に作ったもの

### 実装した

- React/Viteによる操作ツアーと状態遷移
- 日常業務中のSlackへ割り込むAgent体験
- Why now / Why you、出典、接点者、同席候補の提示
- 文面編集、相談、X送信想定、Calendar予定作成
- 面談後の音声メモ、構造化記録、候補者マスタ更新
- 固定周期の接点運用、月次報告、候補探索、Agent Builder
- localStorageへ候補者・運用ルール・接点日を保存するLive Workspace

### 実装しなかった

- Slack、X、Calendar、候補者マスタの実API接続
- 永続DB、Webhook、backend worker
- OAuth、ACL、監査ログ、保持期間、削除伝播
- 実LLM処理、出典評価、再試行、監視
- 実ユーザーへの提供と精度評価

固定ケースで成立した画面上の一致は、本番精度ではない。

## 5. 評価された点と届かなかった点

### 評価された点

- Ambient Agentが普段の業務に入り込み、具体的な行動を促す発想
- 単なるチャットボットではなく、実行までつなげる体験
- 社内のWhats newと候補者のWhy youを重ねる考え方

### 届かなかった点

- 誰のどの失敗を、どの指標で変えるかを固定できなかった
- 仮説の変遷後も、古い固定周期運用と広い機能を残した
- 実データと実コネクタを含む一本のVertical Sliceがなかった
- 技術選択、DB、権限、運用責任を動く証拠として示せなかった
- 実験していないため「どのくらいの精度か」に答えられなかった

審査観点へ対応させると次の通り。

| 観点 | 結果 |
| --- | --- |
| Agentである必然性 | Ambient Agentの発想は一部評価 |
| 顧客業務フローと課題の解像度 | 未達 |
| プロダクトの完成度 | 未達 |

## 6. なぜ負けたのか

画面数や発表の熱量が不足したからではない。

- 課題が本当に大きいことを、件数、失敗例、ユーザー発言で証明していなかった
- 提案から実行、DB更新までを実サービスで貫通させていなかった
- 課題仮説が変わった後もスコープを削らず、価値の核が薄まった
- 「Agentが提案できる」ことと「人の判断と行動が変わる」ことを混同した
- モックを早く渡し、反応を得てから実用品へ変える時間配分ができなかった

良い着眼点は、良いプロダクトの入口にすぎない。

## 7. 本番化するなら

### P0: 課題を一件に絞る

「過去に本気で欲しかった中途候補一人の再活性化」に限定する。前回の断念理由と、再接触してよい条件を実データで確認する。

### P1: 実コネクタのVertical Slice

最初は次の三点だけを実接続する。

1. manager / HRだけが見られるSlackチャンネルへの提案
2. 候補者DBへの接点・状態の記録
3. Calendarへの予定作成

候補者側の公開情報は、当初は人手入力でもよい。価値が未確認の段階で探索基盤を先に作らない。

### P2: 最小データモデル

#### SourceRecord

- `id`
- `source_kind`
- `external_id`
- `url`
- `author`
- `published_at`
- `fetched_at`
- `visibility`
- `content_hash`
- `deleted_at`

#### Claim

- `id`
- `subject_id`
- `claim_text`
- `evidence_ids`
- `claim_type`: fact / self_statement / inference
- `review_status`
- `valid_until`
- `last_corrected_by`

#### Relationship

- `candidate_id`
- `owner_user_id`
- `approved_channels`
- `last_touchpoint_at`
- `next_contact_condition`
- `consent_state`

#### ReferralAction

- `candidate_id`
- `company_signal_id`
- `draft`
- `approved_by`
- `edited_diff`
- `sent_at`
- `outcome`
- `rejection_reason`

### P3: 安全な実行

- OAuthと最小権限
- evidence単位のACL
- 人の承認ゲート
- Tool Callの冪等キー
- 全操作の監査ログ
- 出典削除時の派生データ削除
- センシティブ属性と評判スコアの禁止
- 自動送信を初期スコープから除外

### P4: 小規模パイロット

3〜5人の関係オーナー、5〜20候補で4〜6週間使う。

測る指標:

- 提案採用率
- 文面編集率
- 行動完了率
- 提案から送信までの時間
- 根拠整合率
- 自然に連絡できた割合
- 不適切提案率
- 再接触後の面談化率

## 8. 次回の時間配分

1. 最初の半日で、対象ユーザー、失敗の瞬間、成功指標を固定する
2. すぐ触れるモックを一人へ渡す
3. 翌日も使われるかを見る
4. 反応を得たら画面を増やさず、実データで動く一本へ変える
5. 認証、DB、権限、失敗時処理を含める
6. 余った時間でだけ演出と周辺機能を足す

判断基準は「発表で見栄えがするか」ではなく、「一人に渡して、説明なしで業務が一件終わるか」。

## 9. katazukuへ持ち帰る原則

Ambient Agentは賢いチャットではない。日常の状態を観測し、実行可能な小さな次の一手を作り、結果を監査可能なDBへ残す仕組みである。

katazukuでは次の順番を守る。

1. 実データをsource of truthへ集める
2. 説明可能なルールで状態を作る
3. 決定論的なexecutorで一件を完了する
4. 危険な操作には承認ゲートを置く
5. 成功と失敗をaudit logへ残す
6. その上でLLMによる要約・提案を加える

この順番を逆にしない。
