# リリース手順

バージョンは [Semantic Versioning](https://semver.org/lang/ja/)。0.x の間は後方互換を保証しません。
このプロジェクトは npm 公開せず、clone して使う形です(公開したくなったら本節を更新)。

## 手順

1. `npm run check`(scan + typecheck + test)が通ることを確認。
2. `CHANGELOG.md` の `Unreleased` を新バージョン見出しへ移し、日付を入れる。
3. `package.json` の `version` を上げる。
4. コミット(例: `release: v0.2.0`)。
5. タグを打つ: `git tag v0.2.0 && git push origin v0.2.0`。
6. GitHub Release を作成し、CHANGELOG の該当節を本文に貼る。

## 公開版を private から反映する場合

本番リポジトリの `scripts/oss/publish.ps1`(漏洩スキャナ + テストのゲート)を通してから push すること。
詳細は本番側 `docs/oss-publish.md`。
