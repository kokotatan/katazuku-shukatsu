# katazuku — 就活の自動運転

就活生・奥山彪太郎さん個人のためのプロジェクト。ユーザーは本人ただ一人。
目的: ルーチン・雑務を自動運転し、本人は「考える・受ける・認証する・決める」だけに集中する。
本人が「何を・何のために・どうしたか」を後から確認できる状態を常に保つ(活動ログ)。

## アーキテクチャ(2026-07-18 DB中心化。詳細は docs/specs/08-data.md と AGENTS.md)

```
data/katazuku.db(正本・SQLite・gitignore) ──→ 認証snapshot → アプリ群(読み取り専用)
        ↑                                 └─→ Googleシート(一方向ミラー)
  agent(唯一の書き手): メール / 会話 / 面接 / 提出結果 / カレンダー / 企業研究
```

**方針確定(2026-07-18 本人)**: アプリ群は残す(シートは見えにくいので人間用UIはアプリ)。
廃止されたのは「各アプリが個別にlocalStorageを正として持つこと」だけ。
各アプリは共通 @katazuku/data から /api/data を読む。localStorageに保存する正本データは禁止。

- **書き手はagentのみ**。人はシートを直接編集しない(次のミラーで消える)。修正依頼は会話で受けてDBに書く
- DB入力: db-apply-mail / db-apply-interview / db-apply-submission / db-apply-calendar / db-apply-research
- 人物写真はDB/snapshot/gitへ入れず、person_photo.storage_key + 認証付き /api/photo で配信する
- ステータス更新規則は `sync/src/db.ts` の `transition()` に集約。終了系(不合格/辞退)は根拠があれば確定・
  終了からの復活はしない・手書きの詳細ステータスを粗い進行中で潰さない・「辞退予定」は内定でも上書きしない
- 自律処理は必ず活動ログに1行残す: `scripts/log-activity.ps1`(logs/activity-log.jsonl とシート「活動ログ」タブ)。
  閲覧は `scripts/activity-report.ps1`

## 構成

```
landing/          トップページ / inbox/ status/ insight/ profile/ people/ prep/ impact/  アプリ群(人間用UI)
board/            管理画面SPA(/board/。ミラーを読む窓の参照実装。読み取り専用)
sync/             正本DBと同期エンジン(node:sqlite・依存ゼロ)。db.ts/db-apply/db-mirror/db-import + check-*
scripts/          自動運転ランナー(mail-watch / daily-sync / interview-digest / record-audio / log-activity 等)
chrome-prompts/   Claude in Chrome 用プロンプト台帳(submit.local.md が個人データの正)
docs/             INFRA.md(既存リソース台帳・必読) / specs/ / PROGRESS.md
data/ logs/       正本DBと実行ログ・活動ログ(gitignore。個人データ)
```

アプリはVite+React19+TS+Tailwind v4+smarthr-ui。**localStorageを正本にしない**(DB中心化以前の
一時的な姿。順次ミラー読みへ改修)。api/ は廃止(タグ apps-archive-20260718 に履歴)。

## コマンド

```powershell
npm run build                          # board ビルド + sync 全チェック(これが通らないと完了ではない)
npm --prefix board run dev             # 管理画面の開発サーバー
cd sync; npx tsx scripts/check-db.ts   # DB遷移規則・apply・mirror のテスト
cd sync; npx tsx scripts/check-sheet.ts# 旧シート書込エンジンのテスト(移行完了まで残す)
cd sync; npx tsx scripts/db-inspect.ts [語]  # 正本DBの中身を確認
```

## デザインシステム「SmartHR Design System 準拠」(厳守)

- **絵文字は全面禁止**(UI・コード・コミットメッセージとも)。アイコンは smarthr-ui の Fa*Icon
- コンポーネントは smarthr-ui を第一候補。テーマは `createTheme()` のデフォルト(SmartHRブルー)のまま
- 配色は Tailwind トークンで管理し、値は smarthr-ui の defaultColor と同一に保つ(board/src/index.css):
  slate=グレースケール / blue=プロダクトブルー(操作・リンク) / red=DANGER(締切・警告専用) /
  teal-500=ブランドマーク「片」専用
- フォントは `system-ui, sans-serif`(smarthr-ui本体と同一スタック)。明朝・Webフォント禁止
- 角丸は4/6/8px相当。影よりも罫線(border-slate-300)で区切る

## データとセキュリティ(最重要)

以下は個人情報・秘密情報。**gitに絶対コミットしない**(gitignore済み。新パターンを作ったら必ず追記):
- `data/`(正本DB)・`logs/`(活動ログ・取込アーカイブ含む)・`mirror-out.json`
- `sheet-import-*.json`・`gmail-import-*.json`・`*.local.md`・`service-account.json`・`.env`系
- board/ は認証(Google OAuth readonly)越しにシートを読むだけで、リポジトリにも配信物にも個人データを含めない

## 外部連携

- **既存リソース台帳 `docs/INFRA.md` を必ず先に見る**。新しいクラウドリソースや定常運用を作る前に既存を再利用
  (過去に既存GCPプロジェクト `katazuku` を見落として重複作成した)。新設・変更したら台帳も更新する
- 選考管理シート(ID `1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM`)は**DBの読み取り専用ミラー**。
  タブ「選考管理（新）」「企業マスタ（新）」「活動ログ」。書込はMCP(modify_sheet_values)でagentのみが行う
- 毎日同期: `scripts/daily-sync-prompt.md` が仕様(タスクスケジューラ→claude -p)。
  人事面談・Slack招待・インターン事前準備系のメールは最優先で、自動既読/削除の対象外
- 進捗報告: 大きな作業後は `docs/PROGRESS.md` を更新。ユーザー向けはGoogleシート「katazuku 開発進捗」

## 作法

- UI文言・コードコメント・コミットメッセージは日本語。コミットは機能単位で、ビルド+全テスト通過後に
- 検証スクリプトは `sync/scripts/check-*.ts`(tsx実行・依存ゼロの自前assert形式)に揃える
- Webテスト・コーディングテストの代行受験は不可(本人受験)。ES・メールの事実は submit.local.md が正で創作禁止
- codex CLI と併用する(引き継ぎは AGENTS.md)。大きな実装の後は codex に敵対的レビューをさせると良い
