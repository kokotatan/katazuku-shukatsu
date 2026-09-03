# リリース手順

バージョンは [Semantic Versioning](https://semver.org/lang/ja/)。0.x の間は後方互換を保証しません。
コアライブラリはnpm、ダミーデータ・テスト・閲覧アプリはGitHubから配布します。

## 手順

1. private側の遮断リスト付きscanと `npm run check` が通ることを確認。
2. `CHANGELOG.md` の `Unreleased` を新バージョン見出しへ移し、日付を入れる。
3. `package.json` / `package-lock.json` の `version` を上げる。
4. `npm pack --dry-run` で配布ファイルを確認する。
5. コミット(例: `release: v0.3.0`)し、`main` へpushする。
6. `npm publish --access public` でnpmへ公開する。パスワードやOTPはチャット・ログへ残さない。
7. タグを打つ: `git tag v0.3.0 && git push origin v0.3.0`。
8. GitHub Release を作成し、CHANGELOG の該当節を本文に貼る。

## 公開版を private から反映する場合

本番リポジトリの `scripts/oss/publish.ps1`(漏洩スキャナ + テストのゲート)を通してから push すること。
詳細は本番側 `docs/oss-publish.md`。
