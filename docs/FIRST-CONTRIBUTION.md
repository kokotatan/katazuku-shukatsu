# 最初の貢献ガイド

就活の知識、TypeScript、OSごとの動作確認のどれか一つから参加できます。
デモとテストは架空データで動きます。Googleアカウントの接続・AI契約・就活の実データは不要です。

[English guide](#your-first-contribution) / [参加のルール](../CONTRIBUTING.md)

## 一つ選ぶ

| 関心 | 募集中の課題 | 最初に読む場所 | 小さな成果物 |
|---|---|---|---|
| macOS / Linuxで試す | [#36 Quickstartの動作確認](https://github.com/kokotatan/katazuku-shukatsu/issues/36) | [README](../README.md)、[SETUP](SETUP.md)、`scripts/demo.mjs` | OS・Node.js版・各コマンドの結果と、詰まった説明1箇所 |
| 就活経験・翻訳 | [#37 日英の用語集](https://github.com/kokotatan/katazuku-shukatsu/issues/37) | [ARCHITECTURE](ARCHITECTURE.md)、`schemas/` | 合意した数語の説明案、または `docs/GLOSSARY.md` のPR |
| TypeScript | [ロードマップのCLI表示改善候補](ROADMAP.md#good-first-issue-候補) | `scripts/db-appointment.ts`、`tests/` | 先にIssueで表示例と変更範囲を相談する |

[#36](https://github.com/kokotatan/katazuku-shukatsu/issues/36) と [#37](https://github.com/kokotatan/katazuku-shukatsu/issues/37) は既存のIssueです。
開始前に最新のコメントと関連PRを確認し、一言書いて作業範囲を相談してください。
すでに誰かが進めている場合は、別のOSの確認や用語レビューで協力できます。
候補がすでに終わっていたら [募集中の good first issue](https://github.com/kokotatan/katazuku-shukatsu/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22) を見てください。

コメント例:

> この課題に参加したいです。まずLinuxでデモを試して、起動までの結果と分かりにくかった説明を報告します。

用語集はまとめて完成させる必要はありません。部分的なPRを始める場合は、先に対象の語をIssueで相談してください。
認証・秘密値の保存・外部送信を扱うRFCは、初参加用の課題とは分けています。

## ローカルで確かめる

Node.js 24を推奨します。まだ変更しないなら、そのままcloneして試せます。

```sh
git clone https://github.com/kokotatan/katazuku-shukatsu.git
cd katazuku-shukatsu
npm ci
npm run doctor
npm test
npm run seed
npm run demo -- --no-open
```

デモが表示したローカルURLをブラウザで開きます。終了は Ctrl+C。
デモは初回に閲覧アプリ側の依存もインストールします。インターネット接続はパッケージ取得に使いますが、GoogleやAIの認証は行いません。
実データの設定ファイルや既存の就活DBは、この確認用cloneにコピーしないでください。

コード変更なしなら、[#36](https://github.com/kokotatan/katazuku-shukatsu/issues/36) のコメントか
[動作確認レポート](https://github.com/kokotatan/katazuku-shukatsu/issues/new?template=verification_report.yml) で結果を共有できます。
報告だけの場合は、次のPR手順と全チェックは不要です。

## ファイルを直してPRを出す

1. GitHubでこのリポジトリの **Fork** を作ります。
2. 自分のforkをcloneし、作業用のブランチを作ります。すでに上のcloneがある場合は、新しいフォルダで作業してください。

```sh
# YOUR-USERNAMEを自分のGitHubユーザー名に置き換える
git clone https://github.com/YOUR-USERNAME/katazuku-shukatsu.git
cd katazuku-shukatsu
git switch -c docs/first-improvement
npm ci
```

3. 一つの課題に絞って変更します。利用者に見える変更なら説明と `CHANGELOG.md` の Unreleased も更新します。
4. リポジトリ直下で公開ゲートを実行します。

```sh
npm run check
git diff --check
git diff
```

`npm run check` はコアの検査・全テスト・Cloudflareの設定例のdry-runです。デプロイはしません。
閲覧アプリを変更した場合は、対象アプリのビルドも実行してください。例: `npm --prefix board ci`、`npm --prefix board run build`。
環境の問題でチェックを通せない場合は、失敗した工程を個人情報なしでIssueへ報告して相談してください。

5. `git status` と差分を読み、変更したファイルだけをcommitしてpushします。

```sh
# FILEを今回変更したファイルに置き換える。複数なら空白区切り
git add FILE
git commit -m "初参加向けの説明を改善する"
git push -u origin docs/first-improvement
```

6. GitHubに表示される **Compare & pull request** から、元リポジトリの `main` 宛てにPRを開きます。
   関連Issue、何を変えたか、なぜ必要か、確認結果を書きます。未確認のOSは未確認と記載してください。
   作業途中の相談なら Draft PR も使えます。

ログを丸ごと貼らず、成功・失敗の要約を共有してください。個人のフォルダ名、メール本文、実在企業、APIキー、OAuth情報は公開しません。
詳しい安全境界は [CONTRIBUTING](../CONTRIBUTING.md#方針ここだけは守ってください) と [SECURITY](../SECURITY.md) を参照してください。

## Your first contribution

You can help with Japanese job-hunting terminology, documentation, TypeScript, or platform verification.
English issues and pull requests are welcome. The demo and tests use fictional data; you do not need
a Google connection, AI subscription, or real application data.

Choose an existing task:

- [#36: Verify the Quickstart on macOS / Linux](https://github.com/kokotatan/katazuku-shukatsu/issues/36).
  Share your OS, Node.js version, command results, and one unclear instruction. A report without code changes is welcome.
- [#37: Japanese / English glossary](https://github.com/kokotatan/katazuku-shukatsu/issues/37).
  Discuss a few terms first, then propose explanations or a small documentation PR.
- Browse [open good first issues](https://github.com/kokotatan/katazuku-shukatsu/issues?q=is%3Aissue%20is%3Aopen%20label%3A%22good%20first%20issue%22)
  and check existing comments and related PRs before starting. Comment on the issue to agree on a small scope.

To try the project, install Node.js 24, clone the repository, then run `npm ci`, `npm run doctor`,
`npm test`, `npm run seed`, and `npm run demo -- --no-open` from its root. Open the printed local URL
and stop the demo with Ctrl+C. Package installation needs internet access; account authentication does not.
Do not copy real databases or configuration into this test clone.

To submit a change, fork the repository on GitHub, clone your fork, and create a branch with
`git switch -c docs/first-improvement`. Make one small change, update the relevant documentation and
the Unreleased changelog when applicable, then run `npm run check` and `git diff --check`.
The check includes a Cloudflare example dry-run and does not deploy. For a UI change, also install
and build the affected app, for example `npm --prefix board ci` and `npm --prefix board run build`.

Read `git status` and `git diff`, stage only your changed files with `git add FILE`, commit, and push
with `git push -u origin docs/first-improvement`. Open a pull request against this repository's `main`.
Mention the issue, the reason for your change, commands you ran, and anything you could not verify.
Draft PRs are welcome for work in progress. If a required check fails, share a sanitized summary on the issue first.

For a report without changed files, use the existing issue or the
[verification report form](https://github.com/kokotatan/katazuku-shukatsu/issues/new?template=verification_report.yml);
the full PR checks are not required. For setup failures, use the existing Setup help form.
Never post personal paths, inbox content, real company names, credentials, or raw logs. Keep the
[security boundaries](../SECURITY.md) intact: no unattended email sending, form submission, or aptitude tests.
