# Contributing

ありがとうございます。小さな改善でも歓迎します。

## 最初の参加

- [good first issue](https://github.com/kokotatan/katazuku-shukatsu/labels/good%20first%20issue) から選ぶ
- 作業を始める前にIssueへ一言コメントし、重複を避ける
- 仕様がまだ曖昧なら[Discussions](https://github.com/kokotatan/katazuku-shukatsu/discussions)で相談する

就活経験者の用語レビュー、Windows以外でのquickstart確認、ドキュメントの修正も
コード貢献と同じくらい歓迎します。現在の優先順は[ROADMAP.md](./ROADMAP.md)を参照してください。

## 開発

```sh
npm install
npm run check   # 個人情報scan + 型検査 + build + 全テスト
npm run seed    # 架空データで動作確認
```

- Node.js 22.5+(推奨 24)。`node:sqlite` を使います。
- テストは `tests/check-*.ts`。tsx で実行する依存ゼロの assert 形式に揃えてください。
- 検証したい規則があれば、対応する `check-*.ts` にケースを足してください。

## 方針

- **個人データ・秘密情報をコミットしない**。フィクスチャはすべて架空にする(実在の企業・人物・メール・IDを書かない)。
- **絵文字を使わない**(UI・コード・コミットメッセージとも)。
- コメント・UI文言・コミットメッセージは日本語で構いません。
- 外部への確定操作を扱う変更は、[SECURITY.md](./SECURITY.md) の安全境界を壊さないこと。
  送信・辞退・削除などの操作には承認ゲートと冪等性・監査を必ず残してください。
- ブラウザ操作・資格情報・認証境界の変更は、実装前にIssueで脅威モデルと停止条件を合意してください。

## Pull Request

- 変更は機能単位で、`npm test` が通ってから。
- 何を・なぜ変えたかを説明に書いてください。
