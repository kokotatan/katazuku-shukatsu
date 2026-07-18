# katazuku — エージェント引き継ぎ(codex / Claude 共通)

就活生・奥山彪太郎さん(ユーザーは本人1人)の就活を自動運転する個人プロジェクト。
目的: ルーチン・雑務を自動運転し、本人は「考える・受ける・認証する・決める」だけに集中する。
返答・コメント・コミットは日本語。絵文字禁止。

## アーキテクチャ(2026-07-18 DB中心化。docs/specs/08-data.md)

```
data/katazuku.db(正本・SQLite/node:sqlite・gitignore) ──→ Googleシート(一方向ミラー・スマホ/PC俯瞰)
        ↑                                             ──→ board/(管理画面。ミラーのシートを読むだけ)
  agent(唯一の書き手): メール→ sync/scripts/db-apply.ts / DB→ db-mirror.ts → MCPでシートへ
```

- **書き手はagentのみ**。人はシートを直接編集しない(ミラーで消える)。人の修正依頼は会話でagentが受けてDBに書く
- ステータス更新は `sync/src/db.ts` の `transition()` に集約(終了系は根拠があれば確定・終了からの復活なし・
  手書きの詳細ステータスを粗い進行中で潰さない・「辞退予定」は内定通知でも上書きしない)
- 名寄せ `sameCompany`: NFKC正規化・部分一致は両方4文字以上のみ(トヨタ⊂トヨタ・コニック・プロ誤マージ対策)
- シート(ID 1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM)のタブ「選考管理（新）」「企業マスタ（新）」がミラー先。
  「活動ログ」タブと logs/activity-log.jsonl に、自律処理は「何を/何のために/どうしたか」を必ず1行残す
  (scripts/log-activity.ps1)

## テスト(変更したら必ず全部通す)

```
cd sync && npx tsx scripts/check-db.ts     # DB遷移規則・apply・mirror(39項目)
cd sync && npx tsx scripts/check-sheet.ts  # 旧シート書込エンジン(41項目・移行完了まで残す)
npm run build                              # board(管理画面)ビルド + sync全チェック
```

## 進行中のタスク(2026-07-18時点)

1. **旧アプリ削除(承認済み・未完)**: inbox/ status/ insight/ profile/ people/ prep/ impact/ landing/ api/ を
   git rm し、README.md と CLAUDE.md を新構成に書き直す。個人データJSON(inbox/gmail-import-*.json,
   status/sheet-import-*.json)は先に logs/archive-imports/ へ退避。タグ apps-archive-20260718 に全履歴あり
2. **daily-syncの実走確認**: scripts/daily-sync-prompt.md の新フロー(抽出→db-apply→db-mirror→MCP書込)を初回実行で確認
3. **board/の実機確認**: katazuku.kotalabo.com にデプロイ後、スマホでOAuth→表示確認
4. **次の構想**: 企業研究・面接対策パイプライン(deep research・IR・ブログ/動画・OBOG・業務/顧客/技術理解を
   企業ごとのdossierに集約し、DBと面接準備に接続する)。着手前に本人と設計を確認する

## 禁止・注意

- `credentials/`・`.env`・service-account.json・`data/`・`logs/`・`*.local.md` はコミットしない(gitignore済)
- 選考ステータスを機械的に上書きする変更を入れない(必ず transition() 経由)
- 選考メール・ES の事実は chrome-prompts/submit.local.md(台帳)が正。勝手に事実を創作しない
- Webテスト・コーディングテストの代行受験は不可(本人受験)
- デザイン: SmartHR Design System 準拠(smarthr-ui / Tailwindトークン / system-ui。詳細はCLAUDE.md)
