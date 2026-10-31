# Muse Connector インシデント対応

更新日: 2026-10-31

katazuku Muse Connectorのproduction運用、審査アカウント、remote gateway、所有者端末bridgeに適用します。
通常の不具合、利用者データを含む可能性のある事故、秘密値の漏えい疑いを分けず、疑いの段階から封じ込めを始めます。

## 責任と窓口

| 役割 | 担当 |
|---|---|
| Incident commander / 復旧承認 | Kotalabo operator |
| 利用者サポート、privacy、security窓口 | productionの公開privacy noticeに掲示したoperator security contact |
| Metaへの通知 | Incident commanderがMuse Connector Platformの公式incident経路から実施 |

security incidentである可能性を否定できない場合、Incident commanderは最初の検知から48時間以内にMetaへ通知します。
適用法令またはMetaからより短い期限を指定された場合は、短い方を使います。調査未完了でも、判明事実、影響範囲、
封じ込め状況、次回更新時刻を通知し、推測を事実として書きません。

## 対象事象

- OAuth access/refresh token、owner key、bridge token、credential brokerの秘密が漏れた、または漏れた可能性がある。
- 許可していないscope、tool、利用者、origin、hostからMCPへ到達した。
- gateway、Cloudflare、bridge、正本DB、workflow証跡へ第三者がアクセスした可能性がある。
- gatewayがMCP payloadを永続保存した、または観測・ログ設定が意図せず有効になった。
- action hash、本人承認、Sent照合を迂回した外部操作、誤宛先、重複送信が発生した可能性がある。
- 個人情報、メール、予定、面接記録、応募情報が誤った相手へ表示・送信された可能性がある。

## 0〜4時間: 封じ込め

1. bridgeを停止し、production Workerのrouteを無効化する。成否不明の外部操作は再実行しない。
2. OAuth grantを失効させる。refresh token失効後、既存access tokenとrefresh再利用が拒否されることを確認する。
3. owner keyとbridge tokenをcredential brokerでrotationする。秘密値をissue、chat、ログ、URL、本文へ貼らない。
4. 影響revision、UTC/JST時刻、scope、tool名、run/action hash、HTTP状態、Cloudflare resource IDだけを最小証跡として保全する。
5. メール本文、token、password、回復コード、DB本体をincident ticketへ複製しない。payload loggingを調査目的で有効化しない。
6. 外部送信が関係する場合はSent、受信側受付、元threadを読み取りで照合し、`unknown`のまま再送を止める。

## 4〜24時間: 影響評価

- 影響した利用者、データ分類、scope、tool、期間、地域、受領者、外部操作を根拠付きで列挙する。
- gateway、OAuth KV、Durable Object、bridge、正本DB、workflow store、メールproviderを別々に評価する。
- `muse:production-preflight`のsource hashと、実際にdeployしたrevision、設定、Cloudflare resourceを照合する。
- 関係のない個人データを集めず、保存が必要な証跡には担当者、目的、削除予定を付ける。
- 法令、契約、Meta通知、利用者通知の期限を確認する。確証がない場合も48時間のMeta通知期限を止めない。

## 48時間以内: 通知

Metaへの通知には、検知時刻、事象、影響データ、影響人数、期間、scope/tool、封じ込め、rotation/失効、
再発防止、次回更新予定を含めます。秘密値、認証情報、不要なメール本文は含めません。影響を受ける利用者への通知は、
適用法令と実害を基に、平易な説明、本人が取るべき対応、問い合わせ先を示します。

## 復旧gate

Incident commanderが次をすべて確認するまでproductionを再開しません。

1. 原因を修正した固定Git revisionがあり、review済みである。
2. `npm run check`、Muse gateway E2E、OAuth RFC 7009失効、秘密スキャンが成功する。
3. `muse:production-preflight`が実production設定を通し、source hashがdeploy対象と一致する。
4. 合成審査DBでreadから開始し、scope分離、bridge切断時fail-closed、過大入力、再利用拒否を確認する。
5. live環境では非送信の読取だけで確認し、write、sensitive、actionsを段階的に戻す。
6. 誤送信・重複・成否不明に関係する未解決runを再開せず、個別にreconcileする。

復旧結果、承認者、revision、時刻を活動ログへ残します。再発防止は合成fixtureへ変換し、harness改善loopの
safety gateへ追加します。実在する本文・識別子・秘密をfixtureへコピーしません。

## 終結と削除

終結時に、通知証跡、影響評価、修正revision、検査結果、残るrisk、削除予定を記録します。調査用コピーは目的が終わり次第削除し、
法令・契約上保持が必要なものだけ期間と根拠を明示して残します。Connector解除はOAuth accessを失効させますが、利用者所有の
正本DBを自動削除しません。正本・workflow証跡の削除は、誤消去を避け、利用者が対象とbackupを確認する別の明示手順で行います。

## 四半期tabletop

合成データだけを使い、漏えい疑い、bridge侵害、誤宛先、Cloudflare設定変更の4シナリオを順に実施します。
開始時刻、封じ込め完了、失効確認、48時間通知文面、復旧gateの成否を記録し、失敗を回帰fixtureへ追加します。
