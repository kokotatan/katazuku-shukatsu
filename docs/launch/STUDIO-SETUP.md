# katazuku studio（Zenn記事エディタ）セットアップ

共有サイトの `/studio/` で記事を編集し、ボタンでZennに公開するための初期設定。

## 構成

```
ブラウザ /studio/  ──(合言葉)──>  /api/studio-load  ── GitHub Contents API ─┐
                   ──(Bearer)───>  /api/studio-save  ──────────────────────┤
                                                                            v
                                          kokotatan/zenn-content (articles/*.md)
                                                                            │  push
                                                                            v
                                                      Zenn（published:true の記事だけ公開）
```

- **下書き保存** = `published: false` で `articles/<slug>.md` を commit
- **公開する** = `published: true` で commit → Zennが自動反映

## あなたがやること（初回だけ）

### 1. zenn-content リポを作って push
`C:\Users\okuya\zenn-content` にscaffold済み。GitHubへ公開リポとして上げる：
```sh
cd /c/Users/okuya/zenn-content
git init && git add -A && git commit -m "init zenn-content"
gh repo create zenn-content --public --source=. --push
```

### 2. Zennと連携
https://zenn.dev/dashboard/deploys →「リポジトリを連携する」→ `zenn-content` を選ぶ（GitHub OAuth）。

### 3. GitHubトークン（このリポにcontents:write）
fine-grained PAT を発行（Repository access: `zenn-content` のみ / Contents: Read and write）。ブローカー管理でよい。**チャットに貼らない**。

### 4. Vercel環境変数（katazukuプロジェクト, Production）
| 変数 | 値 |
|---|---|
| `ZENN_REPO` | `kokotatan/zenn-content` |
| `ZENN_USERNAME` | あなたのZennユーザー名 |
| `ZENN_GITHUB_TOKEN` | 手順3のPAT |
| `KATAZUKU_STUDIO_SECRET` | studioの合言葉（自分で決める） |

```sh
# 例（値の入力を求められる）
vercel env add ZENN_REPO production
vercel env add ZENN_USERNAME production
vercel env add ZENN_GITHUB_TOKEN production
vercel env add KATAZUKU_STUDIO_SECRET production
```
設定後に再デプロイ（`vercel --prod`）で反映。

## 使い方
1. `https://katazuku.kotalabo.com/studio/` を開く
2. `KATAZUKU_STUDIO_SECRET` を入力
3. 左の記事一覧から選ぶ（初期は swipecut / katazuku の2本）か「新規」
4. 編集 → 「下書き保存」／出せる状態になったら「公開する」
5. 公開後、返ってきたZenn URLを開いて確認

## 安全設計
- 編集・公開は `KATAZUKU_STUDIO_SECRET`（Bearer）必須。閲覧用の合言葉とは別。
- トークンはVercel環境変数のみ。ブラウザにもGitにも出さない。
- 公開はGit commit経由なので履歴が残り、Zenn側も差し戻し可能。
