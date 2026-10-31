# Muse Connector提出準備

この文書は、katazukuのremote MCP gatewayをMuse Connector Platformへ提出するための審査資料と不足項目を固定します。2026-10-31現在、gatewayは実装・ローカル試験済みですが、Metaへの提出、承認、利用者アカウントへの接続、実メール送信は未完了です。

一次資料:

- [Muse Connector guidelines](https://platform.muse.ai/docs)
- [Muse Connector Terms](https://platform.muse.ai/terms)
- [Museの安全設計](https://research.meta.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse)

## 提供価値と対象

katazuku Connectorは、日本の就職活動に散在するメール、予定、応募、提出物、面談準備、面接記録を、利用者所有の正本SQLiteと証跡付きworkflowへ統合します。Web画面のリンク集ではなく、正本に基づく横断キュー、冪等な記録、日程競合判定、提出物単位の追跡、再送防止、面談準備のready判定を提供します。

対象は、自分でkatazukuをセルフホストし、所有者端末のbridgeを稼働できる本人利用者です。ホスティング、AI利用料、メールアカウント、第三者向け共有環境は含みません。

## データ経路

```text
Muse -> HTTPS/OAuth 2.1 gateway -> 15秒期限のrelay -> 所有者端末のloopback MCP -> 正本SQLite
```

- Cloudflare gatewayはtool引数・結果・正本DBを永続化しません。relay中のpayloadはメモリ上で最大20秒待機します。
- gatewayはOAuthの認可情報、1時間のaccess token、rate-limit状態、再利用防止hashを認証基盤またはDurable Objectへ保持します。
- 個人データは所有者端末の正本DBと、外部操作証跡用のローカルworkflow storeへ保存します。
- Google、iCloud、Muse email connectorの資格情報はkatazuku MCP、gateway、正本DBへ渡しません。
- Muse email connectorでの送信はMeta側のsensitive writeです。katazuku Connector自身はメールを送信せず、actionの検査・hash固定・Sent証跡の記録だけを担当します。

Muse側で接続を解除したときはOAuth RFC 7009のrefresh token失効を受け付け、そのgrantのaccess tokenも直ちに無効化します。
gatewayには削除対象のMCP payloadが残りません。利用者所有の正本DBはConnector用コピーではなく元サービスのデータなので、
Connector解除だけを理由に削除せず、失効tokenからアクセス不能にします。正本自体の削除要求は、誤消去を避けて利用者が管理する
ローカル製品の明示的な削除手順として分離します。

## Tool注釈

Metaの分類では、状態を変えないtoolはRead、正本またはworkflow storeを変えるtoolはWriteです。katazuku Connector内に外部メール送信、購入、予約確定などのSensitive write toolはありません。

### Read

- `katazuku_today`
- `katazuku_next`
- `katazuku_conflicts`
- `katazuku_status`
- `katazuku_availability`
- `katazuku_submissions`
- `katazuku_meeting_preparations`
- `katazuku_actionable_mail`
- `katazuku_applications`
- `katazuku_assessments`
- `katazuku_calendar_outbox`
- `katazuku_work_queue`
- `katazuku_snapshot`
- `katazuku_meeting_preparation_context`
- `katazuku_career_meetings`
- `katazuku_action_status`
- `katazuku_muse_email_status`

`katazuku_snapshot`、`katazuku_meeting_preparation_context`、`katazuku_career_meetings`は個人情報を返すため、OAuthの`katazuku:sensitive`を別scopeにします。Read Only接続では`katazuku:read`だけを選択できます。

### Write（Sensitive writeではない）

- `katazuku_record_mail`
- `katazuku_record_submission`
- `katazuku_record_calendar`
- `katazuku_record_people_research`
- `katazuku_record_company_research`
- `katazuku_record_interview`
- `katazuku_exclude_company`
- `katazuku_record_meeting_preparation`
- `katazuku_prepare_action`
- `katazuku_prepare_muse_email`
- `katazuku_record_muse_email_result`

これらは利用者所有のローカル台帳を更新します。`katazuku_prepare_action`と`katazuku_prepare_muse_email`は外部操作を実行せず、完全な内容をhash固定して`needs_user`で止めます。`katazuku_record_muse_email_result`は、利用者アカウントで対応を確認できたMuse email connectorが返した承認IDとSent再照合証跡を記録するだけです。

### 別Connector上のSensitive write

対応済みMuse email connectorのsend toolは、宛先・件名・本文を表示して毎回`Allow once`を要求します。katazukuの承認hashはMuseのHITLを代替せず、アカウント接続や過去の許可も送信許可として再利用しません。対象メールボックスがMuseで未対応ならこの経路を申告・実行しません。

## 審査用E2Eシナリオ

専用の合成DBとテストアカウントを使い、実在人物・企業・メール本文を含めません。

1. `katazuku:read`だけで接続し、work queue、予定、提出物、空き時間を取得できる。
2. `sensitive`なしでは個人snapshotと面談contextが拒否される。
3. `write`で同じ合成メールを2回記録しても1件に収束する。
4. 古いCalendar、replica DB、競合予定では日時を含むactionが拒否される。
5. `prepare_action`が外部操作を行わず、完全なaction hashと`needs_user`を返す。
6. `prepare_muse_email`後に宛先または本文を変えると証跡記録が拒否される。
7. Muse email connectorの送信は毎回HITLになり、Sentのmessage ID不一致は`unknown`で停止する。
8. timeout後に自動再送せず、状態照会とSent再照合を要求する。
9. OAuth tokenのscope外tool、再利用した認可code、不正Origin、URL内token、過大payloadを拒否する。
10. bridge停止時は503でfail closedし、成功を捏造しない。

ローカルの`npm run test:muse-gateway`は、OAuth全4 scope、Cloudflare Durable Object relay、実bridge、
合成DB、schema-native MCPを一続きで起動し、`read`、`sensitive`、`write`、`actions`を実tool callで検証します。
これはproduction Connectorの審査・接続を代替しませんが、gateway内の偽応答だけでE2E済みと扱うことを防ぎます。

提出用の全tool仕様は、実装とremote policyから次のコマンドでJSON生成します。出力には全28 toolの入力schema、
OAuth scope、Meta権限分類、ローカル副作用、外部確定操作の有無、共通エラー、payload上限、同時実行上限、timeoutを含めます。
手書きの一覧を提出せず、production候補revisionでこの出力を保存してください。

```sh
npm run --silent muse:submission-spec > muse-connector-tool-spec.json
```

## 提出前の未完了項目

- [ ] Connector専用の公開プライバシー通知を`https://www.katazuku-shukatsu.kotalabo.com/muse/privacy/`へデプロイし、外部から本文・更新日・問い合わせ先を確認する（サイト実装と`MUSE-CONNECTOR-PRIVACY-DRAFT.md`は準備済み、まだ未公開）。
- [ ] support/security連絡先と、48時間以内のMeta incident通知責任者を固定する。
- [ ] 事業者情報、ブランド素材、利用規約、保守担当者を提出画面の内容と一致させる。
- [ ] production gateway origin、OAuth client情報、redirect URIを実環境で固定する。
- [ ] 個人データを含まない審査専用アカウント、合成DB、bridge、接続手順を用意する。
- [x] RFC 7009でrefresh tokenを失効すると既存access tokenとrefreshが直ちに拒否され、gatewayにMCP payloadが残らないことをローカルE2Eで確認する。
- [ ] production環境の接続解除と、正本・workflow証跡そのものを利用者が明示的に削除する運用手順を審査アカウントで確認する。
- [x] 全toolの入力、副作用、共通エラー、gateway上限を実装から提出用JSONへ書き出す（出力JSON Schemaは未宣言であることも明記）。
- [ ] `npm run check`と上記E2Eをproduction候補revisionで通し、revisionと結果を保存する。
- [ ] Muse Connector Termsとデータ処理条件を本人が確認し、提出対象・公開範囲を最終承認する。

外部提出は契約同意と公開を伴うため、このチェックリストが完了し、本人が提出内容を確認するまでは行いません。
