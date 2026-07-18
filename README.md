# katazuku-shukatsu

就活を自動運転する個人エージェント基盤。ユーザーは開発者本人ただ一人。

自己分析やESの生成はすでにAIで解ける。残る摩擦は「メールの海の仕分け・締切と日程の管理・
フォーム入力・議事録・企業研究」という機械的なルーチンで、katazuku はそこをエージェントで消し、
本人は「考える・受ける・認証する・決める」だけに集中する。命名は「片付く」に由来する。

## アーキテクチャ(2026-07-18 DB中心化)

```
data/katazuku.db(正本・SQLite) ──→ Googleシート(一方向ミラー。スマホ/PC俯瞰)
        ↑                       ──→ board/(管理画面SPA。ミラーを読むだけ)
  agent(唯一の書き手): Gmail → db-apply / DB → db-mirror → シート
```

- 正本はローカルSQLite1つ。シートとアプリは「見る窓」。書き手はエージェントのみ
- 自律処理はすべて活動ログ(何を・何のために・どうしたか)に記録され、後から確認できる

## 構成

```
board/           管理画面(Vite + React 19 + TS + Tailwind v4 + smarthr-ui。読み取り専用)
sync/            正本DBと同期エンジン(node:sqlite・依存ゼロ) + check-* テスト
scripts/         自動運転ランナー(mail-watch / daily-sync / interview-digest / log-activity 等)
chrome-prompts/  Claude in Chrome 用プロンプト台帳(書類提出・日程返信・イベント予約など)
docs/            インフラ台帳(INFRA.md)・仕様(specs/)・進捗(PROGRESS.md)
```

旧アプリ群(inbox/status/insight/profile/people/prep/impact/landing/api)はタグ
`apps-archive-20260718` にアーカイブ済み。

## 開発

```powershell
git clone https://github.com/kokotatan/katazuku-shukatsu
npm run build                        # board ビルド + sync 全テスト
npm --prefix board run dev           # 管理画面の開発サーバー
cd sync; npx tsx scripts/check-db.ts # DBのテスト単体
```

エージェント向けの詳細な規約は [CLAUDE.md](CLAUDE.md) と [AGENTS.md](AGENTS.md) を参照。

---

[kokotatan](https://github.com/kokotatan)
