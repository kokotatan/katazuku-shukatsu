# Databricksで就活の進行を試しに分析する

Databricksは任意の分析先です。katazukuの正本SQLiteと日常の閲覧アプリは、Databricksなしで動きます。この手順はまず架空データだけで試せます。katazukuからDatabricksへの自動接続・自動送信はありません。

## 架空データで試す

```sh
npm run analytics:export -- --demo
```

`data/databricks/funnel.csv` に `stage,outcome,selection_count` の集計ができます。`data/` はGitの管理対象外です。CSVの行は応募前・応募済と、進行中・合格・不合格・辞退・内定の組み合わせだけです。企業名、氏名、日付、面接内容、メール、自由記述、ID、資格情報を含みません。
既存の出力ファイルは上書きしません。再実行時は別の `--out` を指定するか、内容を確認してから古いCSVを移動してください。

[Databricks Free Edition](https://docs.databricks.com/aws/en/getting-started/free-edition) は学習・実験に使える無償枠ですが、[利用量・機能に制限があり、商用利用はできません](https://docs.databricks.com/aws/en/getting-started/free-edition-limitations)。登録・認証は本人が公式画面で行ってください。

ワークスペースで **New → Add or upload data → Create or modify a table** を開き、架空の `funnel.csv` を選びます。表名を `katazuku_funnel_demo` として作成します。操作の詳細と必要な権限は[公式のファイルアップロード手順](https://docs.databricks.com/aws/en/ingestion/create-or-modify-table)を確認してください。まずプレビューで列が `stage`、`outcome`、`selection_count` の3つだけであることを確かめます。

SQLエディタで作成した表を選択し、次を実行します。数値列が文字列として認識された場合にも `CAST` で計算できます。

```sql
SELECT stage, outcome, SUM(CAST(selection_count AS BIGINT)) AS applications
FROM katazuku_funnel_demo
GROUP BY stage, outcome
ORDER BY stage, outcome;
```

結果を棒グラフにすれば、応募後にどの結果が多いかを確認できます。デモの数字は架空で、成果や合格率の実測ではありません。

## 自分のDBで使う場合

```sh
npm run analytics:export -- --db /path/to/katazuku.db --out /path/to/funnel.csv
```

このコマンドはDBを読み取り専用で開いてローカルCSVを作るだけです。出力内容を開いて確認するまでアップロードしないでください。名前や本文は出しませんが、件数も本人の活動情報です。共有先や利用規約を理解したうえで、本人がアップロードを判断します。自動同期を作る場合も、この集計より細かい情報を黙って増やさず、別の明示的な設定と権限管理を設けてください。

コマンドがDBを見つけられない場合は失敗します。新しい空DBを作成して成功扱いにはしません。
