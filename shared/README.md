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

## 公開版との違い

本体(private)ではこの層がサーバ `/api/data` を叩き、閲覧用の合言葉(`READ_SECRET`)で
保護されています。公開版は**サーバを持たない**ので、`npm run snapshot` が書き出した
ローカルの `snapshot.json` を読むだけです。合言葉も認証もありません
(ローカルのファイルを開いているだけで、守るべき境界がそもそも無いため)。

型 `KatazukuData` は本体と同じ形にしてあります。private 側の改善をそのまま
持ち込めるようにするためで、`docs/oss-publish.md` の同期はこれが前提です。

## node_modules を持たない

依存はアプリ側にしかありません(React が二重に読み込まれるとフックが壊れるため)。
型の解決は各アプリの `tsconfig.json` の `paths` が、実体の解決は Vite の
`resolve.dedupe` が受け持ちます。
