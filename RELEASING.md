# リリース手順

バージョンは [Semantic Versioning](https://semver.org/lang/ja/)。0.x の間は後方互換を保証しません。
コアライブラリはnpm、ダミーデータ・テスト・閲覧アプリはGitHubから配布します。

## 初回公開（現在の `0.3.0`）

npmは新規パッケージの公開に、アカウントの2FAまたは2FAを迂回できる長期トークンを要求する。
長期トークンは使わず、初回だけローカルから対話的に公開する。

1. npmアカウントでWebAuthnの2FA（Windows Hello、Touch ID、セキュリティキー等）を有効化する。
2. 復旧コードをパスワードマネージャー等、第二要素とは別の安全な場所へ保存する。
3. `npm login --auth-type=web` でログインする。生成された認証情報はユーザー領域の
   `.npmrc` にだけ置き、リポジトリへコピーしない。
4. `npm run release:check` を実行する。
5. `npm publish` を実行し、WebAuthnの確認を完了する。
6. `npm view katazuku-shukatsu version dist-tags --json` で公開結果を確認する。

## 2回目以降（Trusted Publishing）

初回公開後、npmのパッケージ設定でTrusted Publisherを1回だけ登録する。

- Provider: GitHub Actions
- Organization or user: `kokotatan`
- Repository: `katazuku-shukatsu`
- Workflow filename: `npm-publish.yml`
- Environment name: `npm`
- Allowed actions: `npm publish`

この設定により、`.github/workflows/npm-publish.yml` がGitHubのOIDCで短時間だけ有効な認証を取得する。
パスワードや長期npmトークンをGitHub Secretsへ保存しない。

通常は、検証済みタグからGitHub Releaseを公開すると自動的にnpmへ公開される。再実行が必要な場合は
Actionsの `npm publish` を手動実行し、既存タグ（例: `v0.3.0`）を指定する。同じversionはnpmへ
再公開できないため、ワークフローは公開済みversionなら何も変更せず正常終了する。失敗後に成果物を
変更する場合はversionを上げる。

## バージョン更新手順

1. private側の遮断リスト付きscanと `npm run check` が通ることを確認。
2. `CHANGELOG.md` の `Unreleased` を新バージョン見出しへ移し、日付を入れる。
3. `package.json` / `package-lock.json` の `version` を上げる。
4. `npm run release:check` で全検査と配布ファイルを確認する。
5. コミット(例: `release: v0.3.0`)し、`main` へpushする。
6. タグを打つ: `git tag v0.3.0 && git push origin v0.3.0`。
7. GitHub Releaseを公開し、CHANGELOGの該当節を本文に貼る。Trusted Publishingがnpm公開を行う。
8. `npm view katazuku-shukatsu version dist-tags --json` で公開結果を確認する。

公開ワークフローはタグと`package.json`のversionが一致しない場合、またはpackage名・公開設定・
repository URLが想定と違う場合に停止する。GitHub Releaseを作る前に、対象タグがmain上の検証済み
コミットを指していることも確認する。

## 公開版を private から反映する場合

本番リポジトリの `scripts/oss/publish.ps1`(漏洩スキャナ + テストのゲート)を通してから push すること。
詳細は本番側 `docs/oss-publish.md`。
