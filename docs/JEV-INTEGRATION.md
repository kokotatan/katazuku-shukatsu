# Jevの活用方針

## 位置付け

Jevは文章生成の代替ではなく、状態に対するChoice / Score / Noul（真である確率）を返す判断モデルである。
個人版はJevを必須にせず、この設計を通常LLMの制御へ取り入れる。具体的には判断を原子的質問へ分解し、
厳格JSONの確率回答だけを許可し、閾値未満をreviewへ送る。安全規則は従来どおり決定論Executorが所有する。

OSS版は同じ判断インターフェースに`llm` / `jev` / `off`を設定できるようにする。Jevは任意adapterであり、
APIキーが無い導入者も通常LLMで同じ制御構造を利用できる。

最初の対象はdaily-syncのメール判定である。

- 就活メールか
- 本人またはkatazukuの対応が必要か
- 期限・予約枠・開始時刻のため早急な確認が必要か
- 日程、提出物、面接、選考結果、案内、対象外のどれか

Jevの結果でメールを破棄したり、選考状態を更新したり、第三者へ送信したりしない。強い不一致、高優先度、低確信を`review`へ送るだけにする。最終的なDB更新、承認、冪等性、Calendar照合は従来の決定論Executorが所有する。

## データ境界

TypeSafe AIへ送るのはdaily-syncが既に抽出した最小情報だけとする。メール本文、Gmail ID、sourceRef、メールアドレスのlocal-partは送らない。送信項目は件名、送信元ドメイン、要約、抽出済みカテゴリ、要対応、期限、会社、職種である。

実通信には次の両方を要求する。

1. ローカル環境の`TYPESAFE_API_KEY`
2. CLIの`--allow-external`

APIキーは`.env`等のgitignore対象だけに置き、ログ・DB・snapshotへ保存しない。

## 試行方法

まず匿名fixtureだけで安全規則を確認する。

```powershell
cd sync
npm run check:jev
```

APIキーを設定した端末で、daily-sync抽出JSONを読み取り専用で評価する。

```powershell
cd sync
npx tsx scripts/jev-assess-daily-sync.ts <抽出JSON> --allow-external --output <結果.local.json>
```

出力は`policy: advisory-only`であり、DBへは反映しない。初期運用はshadow modeとし、既存判定との不一致率、見逃し、誤警告、応答時間、費用を測る。十分な実測後にdaily-syncへ自動接続する場合も、`review`追加以外の副作用は持たせない。

毎朝処理へshadow modeで接続する場合は、`TYPESAFE_API_KEY`をローカル環境だけに設定して次を使う。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/daily-sync-v2.ps1 -EnableJevShadow
```

Jevが失敗してもdaily-sync本体は継続する。結果はgitignore済みの`logs/daily-sync-jev-*.local.json`に保存し、Jevの判断でDB値を上書きしない。

## 次の評価基準

- 期限・予約・選考結果の見逃しを減らせるか
- 既存LLMとの不一致が本人にとって有用か
- 機密境界を守った最小stateで精度が足りるか
- Jev障害時にdaily-sync本体が停止しないか
- 同じfixtureに対する確率分布の変化を追跡できるか
