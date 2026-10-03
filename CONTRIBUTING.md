# Contributing

ありがとうございます。小さな改善でも歓迎します。コードでなくても、
**就活経験者の用語レビュー、macOS / Linux での動作確認、ドキュメントの誤りの指摘**は同じくらい助かります。

## 5分で全体をつかむ

1. [README](README.md) の「しくみ」の図を見る
2. `npm run demo` で閲覧アプリを開く(架空データ・アカウント不要)
3. `npm run workflow -- asa --dry-run` で、AIに何を渡しているかを見る(外部に触れない)
4. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) の「中核の原則」を読む

## 最初の一歩

- 初参加なら [最初の貢献ガイド](docs/FIRST-CONTRIBUTION.md) へ。課題の選び方から fork・PR まで、日英で案内します。
- [docs/ROADMAP.md の good first issue 候補](docs/ROADMAP.md#good-first-issue-候補) か、
  [good first issue ラベル](https://github.com/kokotatan/katazuku-shukatsu/labels/good%20first%20issue) から選ぶ
- 作業を始める前に Issue へ一言コメントし、重複を避ける
- 仕様がまだ曖昧なら [Discussions](https://github.com/kokotatan/katazuku-shukatsu/discussions) で相談する

## 開発環境

```sh
npm ci
npm run check   # 個人情報scan + 型検査 + build + 全テスト + Cloudflare の dry-run
```

- Node.js 22.5+(推奨 24)。`node:sqlite` を使います。コアのランタイム依存はゼロです(増やすときは Issue で相談)。
- テストは `tests/check-*.ts`。tsx で実行する依存ゼロの assert 形式に揃えてください。規則を変えたら対応するケースを足します。
- 閲覧アプリは各ディレクトリ(`board/` など)が独立した `package.json` を持ちます。`npm --prefix board ci && npm --prefix board run build`。
- ワークフローを触るときは、必ず `--dry-run` で渡すプロンプトと能力を確かめてから実行してください。
  実アカウントでの確認は自分のアカウントだけで行い、ログ(`logs/`)を Issue や PR に貼らないでください。

## 方針(ここだけは守ってください)

- **個人データ・秘密情報をコミットしない。** フィクスチャはすべて架空にします(A社〜F社、`you@example.com`)。
  実在の企業名・人名・メールアドレス・ID・メール本文を、コード・テスト・ドキュメント・コミットメッセージに書かない。
  `npm run scan`(`tools/scan-secrets.mjs`)が形で検出しますが、固有名詞は人の目で確かめてください。
- **安全境界を弱めない。** 無人のワークフローから第三者へ送信しない、フォーム送信・予約確定・辞退をしない、
  適性検査を代理しない、AIに正本DBを直接書かせない。外部への確定操作を扱う変更は、承認ゲート・冪等性・監査を必ず残し、
  実装前に Issue で脅威モデルと停止条件を合意してください([SECURITY.md](SECURITY.md))。
- **AIの資格情報を扱う変更は公式の手順どおりに。** 例: Claude は claude.ai ログインを実装しない、
  Sign in with ChatGPT は OpenAI の OSS 向け手順から外れない([docs/AI-PROVIDERS.md](docs/AI-PROVIDERS.md))。
- **絵文字を使わない**(UI・コード・コミットメッセージとも)。
- コメント・UI文言・コミットメッセージは日本語で構いません。

## Pull Request

- 変更は機能単位で。`npm run check` が通ってから出してください。
- 説明には「何を・なぜ・どう確かめたか」を書きます(テンプレートがあります)。未確認のことも書いてください。
- 利用者に見える変更は README / docs と CHANGELOG.md の Unreleased も更新します。

## コードを書かない参加

動作確認の報告や用語の指摘は Issue だけでも歓迎します。
[動作確認レポート](https://github.com/kokotatan/katazuku-shukatsu/issues/new?template=verification_report.yml)には、
OS・Node.js版・試したコマンド・結果を記載してください。失敗した場合は既存の「セットアップで困った」を使えます。
Issueだけの報告に `npm run check` は必須ではありません。ファイルを変更してPRを出す場合は、上の公開ゲートを通してください。

## For English-speaking contributors

Start with [Your first contribution](docs/FIRST-CONTRIBUTION.md#your-first-contribution).
The demo needs no Google account, AI subscription, or job-hunting data. Documentation reviews and
platform verification reports are welcome alongside code changes. English issues and pull requests are welcome.
