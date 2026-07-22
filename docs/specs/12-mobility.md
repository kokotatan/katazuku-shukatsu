# Spec 12: 移動を含む日程調整

最終更新: 2026-07-20(運用設計を追記)

## 目的

カレンダー上の空き時間だけでなく、オンライン・対面の参加形態、現在地、前後の移動、
受付・準備・遅延用の余裕を含めて「実際に参加できるか」を判断する。

特に地方から首都圏企業を受ける新卒就活生について、研究室、オンライン面接、
オフィス訪問、新幹線・飛行機、宿泊を同じ予定モデルで扱える土台にする。

## データモデル

~~~text
place
  自宅・大学・駅・企業オフィス・ホテル・コワーキング
    ├─ mobility_profile
    │    本人の標準余裕時間と移動中オンライン可否
    ├─ appointment_mobility
    │    予定ごとのオンライン／対面、場所、個別バッファ
    ├─ route_estimate
    │    予約前の経路・所要時間見積もり
    └─ travel_segment
         日時確定後の具体的な移動
~~~

## place

場所のstable key、表示名、種類、住所、緯度経度、タイムゾーン、経路provider側ID、
公開範囲、根拠を持つ。

種類:

- home
- campus
- station
- office
- hotel
- coworking
- other

privacyはprivate / shared / public。自宅や大学の住所は原則privateとする。

## mobility_profile

単一ユーザー版の標準ルール。

- 自宅と大学のplace
- オンライン予定の前後バッファ
- 対面予定の前後バッファ
- 1日に入れる対面予定の上限
- 移動中のオンライン参加を許すか
- タイムゾーン

具体的な予定に個別値がある場合はappointment_mobilityを優先する。

## appointment_mobility

既存appointmentを壊さず、移動判断に必要な情報を1対1で追加する。

- attendance_mode: online / in_person / hybrid / unknown
- place_id
- 到着前、終了後、オンライン準備のバッファ
- mobility_status: unreviewed / feasible / tight / infeasible / confirmed
- 判断理由と根拠

in_personとhybridはplaceを必須とする。住所不明の対面予定は確定扱いにしない。

## route_estimate

候補日時を比較するときの所要時間見積もり。

- 出発地と到着地
- 徒歩、公共交通、鉄道、飛行機、車、タクシーなどの移動手段
- 所要時間と遅延用バッファ
- manualまたは経路adapterのprovider
- 取得根拠と有効時刻

source_refを冪等キーにする。最初は本人が設定した固定時間で動かし、
後から任意の経路API adapterへ差し替えられる。

## travel_segment

面接日時が確定した後の具体的な移動。

- 前後のappointment
- 出発地、到着地、出発・到着時刻
- 移動手段、予約状態、経路参照
- 所要時間と余裕時間
- 金額、通貨、企業負担対象か
- カレンダー側ID

source_refを冪等キーにし、同じ切符・移動を二重作成しない。

## プライバシー

place.address、緯度経度、travel_segmentはローカルDBだけに保存する。
listPlatformSnapshotには含めず、Vercel Blob、アプリ共通snapshot、Git、ダミーデータへ出さない。

OSSのfixtureは架空住所だけを使う。issueへ実住所、訪問先、切符、移動履歴を投稿しない。

## CLI

~~~powershell
scripts/mobility.ps1 -Action place -InputJson place.json
scripts/mobility.ps1 -Action profile -InputJson profile.json
scripts/mobility.ps1 -Action appointment -InputJson appointment.json
scripts/mobility.ps1 -Action route -InputJson route.json
scripts/mobility.ps1 -Action segment -InputJson segment.json
scripts/mobility.ps1 -Action list
~~~

書き込みはdb-mobility.tsを経由し、PowerShellランナーがsnapshotと活動ログを更新する。

## 日程判定の順序

次段のスケジューラーは候補枠ごとに次を行う。

1. 前後の確定appointmentを探す
2. appointment_mobilityから参加形態と場所を解決する
3. route_estimateから必要移動時間を得る
4. profileと予定固有のバッファを加える
5. 移動ブロック、最終交通、対面上限と衝突しないか判定する
6. feasible / tight / infeasibleと理由を返す
7. 本人の事前条件内で一意なら予約し、travel_segmentとカレンダー予定を作る

## 今回の実装範囲

- 5テーブルと制約
- ローカルDB API
- 冪等なCLI
- snapshotから住所・移動履歴を除外
- 15件の回帰テスト

経路検索、候補枠の自動評価、切符・宿泊予約、交通費申請はまだ接続しない。
外部サービスに依存せずDB契約を先に固定し、adapterとして段階的に追加する。

---

# 運用設計(2026-07-20 追記)

以下はテーブル基盤(上記)の上で「実際に誰が・いつ・何をするか」を定める。
実ケース3件(日本トレカセンター大阪3次、LayerXハッカソン東京、PKSHA本郷1day)で検証済み。

## 1. トリガー: 対面予定がDBに入ったら

appointmentの書き手は既存の6入力(db-apply-mail / db-apply-calendar / db-apply-interview 等)のまま。
mobilityは**後段レビュー**として動く。daily-syncの1ステップに「mobility-review」を追加し、
次の条件の予定を検出する。

- 未来のappointmentで、appointment_mobilityが無い
- または attendance_mode = 'unknown' のまま
- または 開始時刻・場所が更新されたのに mobility_status が古い(source_refで検知)

検出したらagentが順に行う。

1. **参加形態の判定**: 案内メール本文・location・URLから online / in_person を判定。
   確信が持てなければ unknown のまま「本人への確認事項」に回す(勝手に対面と断定しない)
2. **place解決**: 対面なら会場のplaceをupsert(kind=office、company_id紐付け、住所は案内メールが根拠。
   source_refにメールIDを入れる)。住所不明なら mobility_status は unreviewed のまま
3. **経路見積**: 標準経路マスタ(§3)から route_estimate を引く。無い区間はmanualで概算を作る
4. **前泊・後泊判定**(§3の規則)→ mobility_status(feasible / tight / infeasible)と
   decision_reason(判定式と数値を文章で残す)を書く
5. **本人への提案**: 朝のまとめ(asaメール)に「移動」セクションとして出す。内容は
   往路・復路の候補、宿泊要否、概算費用、交通費支給の確認状況、本人にしか決められない点
6. **本人が了承**(会話で受ける)→ agentが travel_segment(status=planned)と
   カレンダー移動ブロック(§5)を作成
7. **本人が切符・宿を購入/手配**(§7: 購入はagentがやらない)→ 会話報告または購入確認メールを
   根拠に status を ticketed / reserved へ、cost_amount を記録

開始時刻が未確定の予定(例: 「8/1のどこか」)は判定せず、「開始時刻の確認」を提案に含めて
unreviewed のまま置く。時刻確定メールが来たら再レビューする。

## 2. データフローと責務

~~~text
appointment(既存6入力・agent)
   │ mobility-review が検出
   ▼
appointment_mobility(agentが自動upsert。confirmedにするのは本人了承後だけ)
   │ 標準経路マスタ or manual見積
   ▼
route_estimate(agent。provider=manual→将来adapter。sourceRefで冪等)
   │ 本人了承
   ▼
travel_segment(作成=agent(了承後)。status遷移=agentだが根拠必須)
   │
   ▼
careerカレンダーの移動ブロック(agent。calendar_external_id書き戻しで冪等)
~~~

| 段 | 書き手 | いつ | 根拠 |
| --- | --- | --- | --- |
| appointment | agent | メール・会話の取込時 | 案内メール等 |
| appointment_mobility | agent | mobility-review時に自動 | メール本文・location |
| route_estimate | agent | 見積時(標準マスタ or 概算) | マスタ/経路検索 |
| travel_segment | agent | **本人了承後** | 会話の了承・購入確認メール |
| status: planned→reserved/ticketed | agent | 本人報告・確認メール検出時 | えきねっと/宿の確認メール |
| status: →completed | agent | daily-syncで過去日時を消込 | 日時経過 |
| status: →cancelled | agent | 選考辞退・不合格・日程変更時 | 結果メール・本人指示 |

本人が書くテーブルはない(DBの書き手はagentのみの原則を維持)。本人の役割は
「了承する・買う・領収書をもらう」の3つ。

## 3. 移動所要の標準パターンと前泊判定

時刻・金額は**設計時点の目安**。実運用では必ず経路検索か本人確認で検算する
(JST曜日と同じく、時刻を推測で書かない)。標準経路マスタとしてseed投入し、
route_estimate(provider=manual)の初期値にする。

### 標準place(seed対象)

home(自宅・private)/ campus(東北大・private)/ sendai-station(仙台駅)/
tokyo-station(東京駅)/ shin-osaka-station(新大阪駅)/ sendai-airport(仙台空港)

### 仙台⇔東京

- はやぶさ 仙台—東京 約1時間35分。自宅→仙台駅 約30分。東京駅→都内会場 30〜60分
- door-to-door 目安: **自宅→都内会場 約3時間〜3時間半**(route_estimate: 190分+バッファ30分)
- 上り始発: 仙台6:00前後発→東京7:35前後着 → **都内9:00集合から日帰り往路可**
- 下り最終: 東京21:40台発仙台行 → **東京駅を21:30までに出られない終了時刻なら後泊**
- 片道費用目安: 11,000〜11,500円(はやぶさ指定席)

### 仙台⇔大阪

- 鉄道: はやぶさ+のぞみ乗継で仙台—新大阪 約4時間10分。door-to-door **約5時間半**
  (route_estimate: 330分+バッファ30分)
- 上り始発接続: 仙台6:00前後発→新大阪10:20前後着→梅田11:00前後 →
  **大阪で12:00より前の集合は前泊必須**、13:00集合はtight
- 復路: 東京21:40台の最終はやぶさに接続できる新大阪発は**18:30〜19:00頃が実質最終**(要検算)。
  それ以降に終わる予定は後泊
- 空路の代替: 仙台空港—伊丹 約1時間20分(door-to-door約4時間)。本数が少ないため
  提案時に選択肢として併記し、本人が選ぶ
- 片道費用目安: 鉄道 21,000〜22,500円

### 前泊・後泊の判定規則

~~~text
必着時刻 = 集合時刻 − arrival_buffer(予定固有 > profile.in_person_before、既定30分)
始発到達 = 始発ベースのdoor-to-door見積で計算した最速到着時刻

始発到達 + 30分 ≦ 必着時刻  → 日帰り往路 feasible
始発到達        ≦ 必着時刻  → tight(本人に前泊も併記して提案)
始発到達        >  必着時刻  → 前泊必須(hotel placeと前日移動を提案)

離脱時刻 = 終了時刻 + departure_buffer(既定30分)+ 会場→駅の移動
離脱時刻が最終列車の発時刻に間に合わない → 後泊
~~~

判定式と使った数値は必ず decision_reason に文章で残す(後から本人が検算できるように)。

## 4. 交通費の記録

- reimbursable = 「企業負担の対象か」。1=支給あり(全額・一部とも)、0=自費または未確認
- **支給有無が確認中**の間は reimbursable=0 のまま、decision_reason に「支給確認中(◯/◯問い合わせ)」と
  書き、提案に確認状況を毎回載せる。三値(支給/不支給/確認中)の列挙と、領収書要否・精算済み日付の
  列は未実装(残タスク4)。それまでは decision_reason とカレンダーblockのdescriptionで運用する
- **領収書が必要**な予定(例: PKSHA)は、移動ブロックのdescriptionに「領収書必須」と書き、
  前日リマインダーの文言にも入れる。取得した領収書は `data/receipts/`(gitignore)へ保存
- **手配代行(ピカパカ等、企業側が切符・宿を手配)**の場合も travel_segment は作る
  (移動ブロックとリマインダーのため)。provider に手配元(例: pikapaka)、cost_amount=0、
  reimbursable=1、status は手配確認メールを根拠に reserved / ticketed。本人の立替は発生しない
- 費用は「本人が実際に払った額」を cost_amount に入れる。支給されて実費ゼロなら0

## 5. カレンダー連携(既存規約との整合)

既存規約: 就活=careerカレンダー、人と話す本番=トマト(11)、辞退・不合格=グレー(8)、
仮=バナナ(5)。移動はこの規約を壊さない。

- **移動ブロック**は careerカレンダーに**通常色(色指定なし)**で入れる。
  トマトは本番専用、グレーは終了系専用なので使わない
- 検討段階(planned前・本人未了承)の移動はカレンダーに**入れない**(DBだけ)。
  カレンダーに出すのは travel_segment を作った後
- タイトル規約: `移動: 仙台→東京(はやぶさ102号)` / `移動: 会場→東京駅` のように
  区間+便名。descriptionに travel_segment の source_ref と領収書要否を書く
- **宿泊**は終日予定 `宿泊: 浅草橋(手配済み)` を通常色・availability=FREE で入れる
  (place kind=hotel と紐付け。DB上の一次データは残タスク5)
- 作成後は eventId を calendar_external_id へ書き戻す(appointmentのoutboxと同じ冪等規約)
- timeZone=Asia/Tokyo、前日+直前popupリマインダー。曜日はJSTで検算
- 予定側(面接本番)の色は従来通り: 面接=トマト、参加確定インターン本番=トマト
- 選考辞退・不合格になったら: 本番予定はグレーで残す(既存規約)、**移動ブロックは削除**し
  travel_segment を cancelled に。購入済み切符・宿があれば「払戻し要」を本人へ通知する

## 6. 実ケースでの検証

### ケースA: 日本トレカセンター 3次対面 8/1(土)大阪・梅田(交通費支給を確認中)

- 集合時刻が確定するまで mobility_status=unreviewed。提案には「開始時刻の確認」を出す
- 時刻確定後: 12:00より前の集合なら前泊必須、13:00集合はtight(§3)。
  17:30以降に終わるなら後泊(新大阪の実質最終に間に合わないため)
- 交通費: 支給確認の返信待ち。reimbursable=0のまま decision_reason に「支給確認中」。
  往復概算 約43,000〜45,000円を提案に明記し、本人が受験判断の材料にできるようにする
- 検証で判明した不足: 「開始時刻不明」の扱い(→§1に規定)、支給3値の列挙(→残タスク4)

### ケースB: LayerXハッカソン 8/8(土)-9(日)東京(はやぶさ102号 仙台7:21発・ホテル浅草橋手配済み)

- 複数日イベント+中間泊。travel_segment は往路(8/8 自宅→会場、便名=はやぶさ102号)と
  復路(8/9 会場→自宅)の2本。door-to-doorで1本に丸める(乗換ごとに分割しない)
- 宿泊は place(kind=hotel、浅草橋)+終日予定で表現。宿泊費・手配元を持つ一次データが
  DBに無いことが判明(→残タスク5)。それまでは往路segmentのdescription相当
  (decision_reason)に記録する
- 切符購入済みなら status=ticketed、本人購入なら cost_amount に実費
- カレンダー: ハッカソン本番=トマト(参加確定)、移動ブロック2本+宿泊終日=通常色

### ケースC: PKSHA 1dayインターン 10/6(火)11:00-18:30 東京・本郷(交通費全額支給・領収書必要)

- 必着10:30(バッファ30分)。仙台7:21発→東京8:58着→本郷9:40頃 → **日帰り往路feasible**
  (始発でなくてよい)
- 復路: 18:30終了+30分+駅まで40分 → 東京駅20時台発で仙台21時台着。最終より前 → **日帰り可**
- reimbursable=1。移動ブロックdescriptionと前日リマインダーに「領収書必須」。
  えきねっと購入なら領収書PDF、窓口購入なら紙をもらい `data/receipts/` へ
- 検証で判明した不足: receipt_required の列が無い(→残タスク4)。それまでは運用でカバー

## 7. 安全規則(本人確認の線引き)

**agentがやらないこと(常に本人)**

- 切符・航空券・宿泊の**購入・決済・キャンセル・払戻し**(えきねっと等のログイン操作を含む)
- 宿泊先の選定確定(候補提示まではagent)
- 企業への交通費支給有無・集合場所の**問い合わせメール送信**
  (下書きはagentが作るが、本文全文を見せて本人が送信可否を判断する既存規約に従う)

**agentが自律でやってよいこと(活動ログ必須)**

- appointment_mobility / route_estimate の作成・更新(見積と判定)
- 本人了承後の travel_segment 作成、確認メールを根拠にした status 遷移
- カレンダー移動ブロック・宿泊ブロックの作成・更新・(辞退時の)削除
- 朝のまとめへの移動セクション追加、リマインダー設定

**境界の原則**: 「お金が動く・外部に意思表示する・現地に体を運ぶ判断」は本人。
「記録する・見積もる・提案する・確定情報を転記する」はagent。
迷ったら提案側に倒す(勝手に買わない・勝手に問い合わせない)。

## 8. 実装残タスク(優先順)

1. **mobility-review本体**: daily-syncに組み込む未レビュー対面予定の検出+標準経路からの
   自動見積+前泊判定+asa提案文生成。`sync/scripts/` に実装し `check-*.ts` 形式のテストを付ける
2. **標準経路マスタのseed**: §3のplace6件と仙台⇔東京・仙台⇔大阪のroute_estimateを
   JSON+`scripts/mobility.ps1` で投入(冪等)。時刻・金額は投入時に検算する
3. **カレンダー移動ブロック出力**: travel_segment→careerカレンダー(outbox方式。
   calendar_external_idが空のsegmentを出力し、eventIdを書き戻す)。タイトル・色は§5の規約
4. **交通費の列挙拡張**: reimbursement_status(unknown / none / full / partial / fixed)、
   receipt_required、receipt_path、reimbursed_at 列のマイグレーションとdb-mobility対応。
   既存 reimbursable からの移行を含む
5. **宿泊の一次データ**: stayテーブル(place_id、check_in/out、手配元、費用、企業負担、予約状態)
   を追加するか travel_segment を拡張するかを決めて実装(ケースBで必要になった)
6. **消込処理**: 過去日時のtravel_segmentをcompletedへ、領収書未取得のリマインド消込。
   daily-syncの後処理に追加
7. **経路adapterのインターフェース定義**: provider差し替え点(駅すぱあと・Google Routes等)の
   型だけ先に固定。外部API接続は急がない
