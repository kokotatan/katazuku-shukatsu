# @katazuku/data（アプリ群の共有データ層）

`board/` などのアプリが共有する、正本DBスナップショットの**型と読み口**です。
ビルドしません。各アプリの Vite が `@katazuku/data` を
`shared/src/index.ts` へエイリアス解決して直接読みます。

## 公開版との違い

本体(private)ではこの層がサーバ `/api/data` を叩き、閲覧用の合言葉(`READ_SECRET`)で
保護されています。公開版は**サーバを持たない**ので、`npm run snapshot` が書き出した
ローカルの `snapshot.json` を読むだけです。合言葉も認証もありません
(ローカルのファイルを開いているだけで、守るべき境界がそもそも無いため)。

型 `KatazukuData` は本体と同じ形にしてあります。private 側の改善をそのまま
持ち込めるようにするためで、`docs/oss-publish.md` の同期はこれが前提です。
