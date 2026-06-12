# Spec 01: 返信文生成API (/api/generate-reply)

## 背景

Inboxの返信モーダル(`inbox/src/components/ReplyModal.tsx`)は既に
`POST /api/generate-reply` を呼ぶ実装になっているが、**サーバー側が存在しない**。
これを実装して、メールカードの「返信」ボタンからClaude生成の返信文が出るようにする。

## 要件

1. `api/generate-reply.ts` を新規作成(Vercel Functions形式。`vercel.json` は設定済みなので
   `api/` ディレクトリに置けばそのままデプロイされる)
2. 入力: Inboxの `Email` オブジェクト(`inbox/src/types.ts` 参照)がJSONで丸ごと届く
3. 処理: Claude API(model: `claude-haiku-4-5`、軽くて十分)で日本語のビジネス返信文を生成
   - システム指示の要点: 就活生(東北大学大学院・奥山彪太郎)から企業採用担当への返信。
     カテゴリ別の意図 — interview=日程候補を3つ提示(日時はプレースホルダ「〇月〇日(〇) 00:00〜00:00」のまま)、
     test=期日までに受検する旨、task=対応する旨、result=確認した旨。
     署名は「奥山 彪太郎 / 東北大学大学院 / okuyama.kotaro.career@gmail.com」。
     絵文字・顔文字禁止。本文のみを返す(件名や説明文を含めない)
4. 出力: `{ body: string }`。エラー時は `{ error: string }` + 適切なHTTPステータス
5. APIキーは環境変数 `ANTHROPIC_API_KEY`(Vercelの環境変数 + ローカルは `.env.local`、gitignoreに追加)
6. **フォールバック**: APIキー未設定・API障害時は、ルールベースのテンプレートを返す
   (git履歴の `inbox/src/lib/reply.ts` 旧実装 `buildReplyTemplate` を api 側に移植して使う)。
   モーダルが「生成できませんでした」で止まらないこと
7. ローカル開発: `inbox/vite.config.ts` に `/api` → `http://localhost:3000` のproxyを追加し、
   `vercel dev` で動かす手順を README か docs/PROGRESS.md に記す

## 受け入れ条件

- `vercel dev` 起動下で、Inboxのメールカード「返信」→ 数秒でカテゴリに応じた自然な日本語返信文が
  textarea に入る。「Gmailで開いて送信」で宛先・件名・本文入りのGmail作成画面が開く
- APIキーを外した状態でもテンプレート文が返り、UIが機能する
- メール本文(個人情報)をログに出力しない
- `npm run build` と既存テスト全通過
