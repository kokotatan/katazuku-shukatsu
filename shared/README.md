# shared（アプリ群の共有層）

8本のアプリ(`board` `insight` `status` `inbox` `people` `prep` `profile` `impact`)が共有する層です。
ビルドしません。各アプリの Vite がエイリアスで直接読みます。

| 入口 | 中身 |
|---|---|
| `@katazuku/data`(`src/index.ts`) | 正本DBスナップショットの**型と読み口**。`KatazukuData` と日付・名寄せの小道具 |
| `@katazuku/ui`(`src/ui.tsx`) | 共通UI。`AppShell` / `AppNav` / `DataState` / `AppHeading` / `Tile` |

## AppNav をここに1つだけ置いた理由

本体(private)では同じ内容の `AppNav.tsx` を8つのアプリへコピーして同期しており、
ファイル冒頭に「コピー同期すること」と書いてあります。アプリを1本足すたびに8ファイル直す、
という手作業をOSSへ持ち込みたくないので、公開版では `shared/` に1つだけ置いています。

## 閲覧の境界

`src/connection.ts` がタブごとの接続を管理し、`src/useKatazukuData.ts` を全8アプリで共有します。
本人の保存先を確認してから、30分間の閲覧セッションで `/api/data` を読みます。HTMLの代替応答、形式不正、過大な本文、別の接続先、期限切れを区別して停止します。

長期キーと個人データはWeb Storageへ保存しません。アプリ間の移動に必要な短期セッションだけを `sessionStorage` に保存します。解除・接続先の変更はタブ間にも伝え、進行中の通信を停止します。遅れて返る応答で前のデータを戻さないよう、接続の世代も照合します。

`DataState` は未接続時に見出しと配置だけを表示します。例の企業・数値・日時は作らず、未接続・未同期・読取失敗を区別します。データの型と検証は `src/viewer-types.ts` と `src/snapshot-contract.ts` を共有します。

PCアプリからの自動連携と、一般利用者向けの初回セットアップは未完成です。詳細設定による手動接続だけをもって導入完了とは扱いません。

## node_modules を持たない

依存はアプリ側にしかありません(React が二重に読み込まれるとフックが壊れるため)。
型の解決は各アプリの `tsconfig.json` の `paths` が、実体の解決は Vite の
`resolve.dedupe` が受け持ちます。
