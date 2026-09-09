# エージェント起動時間の測定（2026-09-08）

対象は `scripts/invoke-agent.ps1` の共通起動経路。遅いワークフローや目標秒数の指定がないため、最初に副作用のない DryRun で起動待ちを切り分けた。AI推論・MCP接続・メール取得を含む実運用全体の測定ではない。

## 条件と結果

同一端末、同一作業ディレクトリ、Node.js v24.16.0、npm 11.13.0。各回、新しい PowerShell プロセスを起動。変更前後に同じコマンドを5回ずつ順次実行し、終了までを Stopwatch で測定した。前後の測定終了後にビルドを開始した。

```powershell
$sw = [Diagnostics.Stopwatch]::StartNew()
$out = & powershell -NoProfile -File scripts/invoke-agent.ps1 -Workflow performance-probe -RunId performance-probe -PromptText probe -DryRun
$sw.Stop()
if ($LASTEXITCODE -ne 0) { throw 'dry run failed' }
$sw.Elapsed.TotalMilliseconds
```

| 回 | 変更前（ms） | 変更後（ms） |
|---|---:|---:|
| 1 | 2796.998 | 1682.023 |
| 2 | 2905.347 | 1805.885 |
| 3 | 2596.149 | 1840.903 |
| 4 | 3374.068 | 1410.557 |
| 5 | 3058.856 | 1849.217 |
| 中央値 | 2905.347 | 1805.885 |

この条件で起動時間の中央値は約1.10秒（37.8%）短縮。5回ずつの逐次測定であり、別端末・長期運用で同じ短縮率を保証するものではない。

## 原因と変更

毎回 `npx` がパッケージ実行の準備をしてから、導入済みの `tsx` を起動していた。`sync` ディレクトリで `npx.cmd tsx --version` と `node node_modules/tsx/dist/cli.mjs --version` を交互に各5回測ると、それぞれ1191〜1777ms、135〜240msだった。AIの処理開始前に、この準備の時間が加わっていた。

導入済みの同じ `tsx` を Node.js から直接呼び出すように変更。ローカルの `tsx` または Node.js が見つからない場合は従来の `npx` 経路へ戻す。子プロセスは非表示で起動する。変更は共通ランチャー内に限定した。

測定の生データと変更直前のスクリプトは `.tmp/agent-perf/` に保存（ローカルのみ）。本番AIや外部サービスを実行しない測定のため、実運用全体の主要な待ち時間が解消したかは未確認。

## 検証

変更後の DryRun 5回で終了コード0、workflowIdと起動プレビューの生成を確認。不正な TimeoutMs の指定は終了コード1で失敗することを確認した。

`npm run build` は終了コード0。8アプリのビルド、check-sheet、check-db、check-application、check-mobility、check-agent-runtime、check-daily-sync-apply、check-workflow-control、ローカル資格情報ブローカーのチェックが成功した。ログは `.tmp/agent-perf/build.log`。依存未導入時のnpxフォールバックと実AIを含む本番経路は今回の実測対象外。

## 追加改善：Gmail本文の取得

`gmail-fetch.ts` は本文の取得を1件ずつ待っていた。読取を最大5件ずつ同時に行い、保存は元の検索結果順で行うよう変更した。バッチ内の全通信の終了を待ち、失敗した位置以降は保存せず、次のバッチも開始しない。添付の保存とアカウントの処理は元の順序を維持する。失敗したバッチ内では、後続の最大4件を先に読んでいる場合がある。

実ネットワークを遮断したテストで、25件・2ページ・1件40〜50msの模擬通信待ちを同じ条件で変更前後各3回測定した。OAuthも架空の認証情報と応答を用い、実メールや正本DBを使用していない。

| 回 | 変更前：CLI全体（ms） | 変更後：CLI全体（ms） | 変更前：本文取得区間（ms） | 変更後：本文取得区間（ms） |
|---|---:|---:|---:|---:|
| 1 | 1604.975 | 491.788 | 1341.221 | 287.424 |
| 2 | 1497.968 | 440.931 | 1321.313 | 294.618 |
| 3 | 1494.976 | 433.001 | 1347.691 | 295.196 |

CLI全体の中央値は1497.968→440.931ms（70.6%短縮）。これは模擬通信での結果であり、実Gmailの短縮率ではない。本番での待ち時間は件数とサーバー応答に依存する。

再検証は `cd sync` 後に `node --import tsx scripts/check-gmail-fetch.ts`。本文・保存順・ページ送り・添付内容・同時実行上限・HTTP 429時の保存範囲・後続アカウントの継続・0件時の処理を確認する。比較用旧実装は引数で指定できる。生データは `.tmp/agent-perf/gmail-before.json` と `gmail-after.json`。

## 追加改善：毎朝の同期の工程CLI

`daily-sync-v2.ps1` と `invoke-workflow-agent.ps1` は工程の開始・完了・検証ごとにnpxを起動していた。`tsx-command.ps1` で導入済みtsxを直接起動する経路を共有した。各工程の順序、入力、終了コードの検査はそのまま。

同一端末・同一条件で `workflow-control.ts step-config --contract workflows/daily-sync.json --step extract` の読取のみを各5回測定した。

| 回 | npx経由（ms） | 変更後の共通起動経路（ms） |
|---|---:|---:|
| 1 | 1464.660 | 284.183 |
| 2 | 1197.071 | 277.772 |
| 3 | 1256.754 | 272.365 |
| 4 | 1115.613 | 299.111 |
| 5 | 1146.437 | 272.173 |

中央値1197.071→277.772ms（76.8%短縮）。測定対象は工程設定の取得1回であり、同期全体の短縮秒数は未測定。生データは `.tmp/agent-perf/workflow-before.json` と `workflow-after.json`。起動結果、不正な工程名での失敗、依存未導入時のnpx経路選択、変更したPowerShellの構文を確認した。

追加変更後も `npm run build` は終了コード0で、8アプリと指定の全回帰チェックが成功。ログは `.tmp/agent-perf/build-followup.log`。Gmail専用の回帰テストも別途成功した。稼働中MiniPCへの反映と実サービス全体の所要時間は今回の確認範囲外。
