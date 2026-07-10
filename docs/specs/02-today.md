# Spec 02: Katazuku Today (今日やることダッシュボード)

> 【実装済み・注記 2026-07-10】本specは実装完了。フォルダ名は命名統一(2026-06-13)で
> `today/` → `insight/`(URL `/insight/`)に改名済み。以下の旧名は当時の記述のまま。

## 目的

朝開いたら「今日動くべきこと」だけが1画面に出る。Inbox(メール)とPipeline(選考ボード)に
散らばった締切・予定を横断して集約する。ランディングの「〇三 Coming soon」枠を埋める。

## 要件

1. 新アプリ `today/` を作る(inbox/pipelineと同じ Vite + React 19 + TS + Tailwind v4 構成。
   `vite.config.ts` の `base: '/today/'`。ルート `package.json` の build と
   `scripts/assemble.mjs`、`landing/index.html` のカード(〇三)も更新する)
2. データソースは同一オリジンのlocalStorageのみ(読み取り専用。書き込みはステータス更新だけ):
   - `katazuku-inbox/emails` … 要対応メール(needsAction, status=inbox)と締切
   - `katazuku-pipeline/companies` … nextDate付きの企業
3. 画面構成(1カラム、上から):
   - 「今日」セクション: 今日が期限/予定のもの(メール・企業混在、時刻順)
   - 「期限切れ」セクション: 過ぎているもの(朱色の左バー)
   - 「今週」セクション: 7日以内
   - 各行: 企業名 / やること(actionSteps or nextAction) / 残り時間 / 出典リンク
     (inboxの件は /inbox/ へ、pipelineの件は /pipeline/ へ遷移)
   - 行のチェックボタンで「片付けた」(inboxメールは status=done に、pipeline企業は触らない)
4. ヘッダーは既存アプリのHeader実装を踏襲(「片」角印 + katazuku + TODAY)。
   日付を「6月12日(金)」形式でfont-display表示
5. storageイベント購読で、他タブの変更を開いたまま反映(pipeline/src/App.tsx の実装を踏襲)

## デザイン

CLAUDE.md のデザインシステム(帳簿的ミニマリズム)に完全準拠。
絵文字禁止・朱は期限切れ/今日のみ・罫線区切り。空状態は font-display で「今日は、もう何もない。」

## 受け入れ条件

- `npm run build` で dist/today/ が組み上がり、landing からリンクされる
- inbox/pipelineのデモデータだけでも意味のある表示になる
- `today/scripts/check-aggregate.ts` を追加(集約・ソートロジックの単体テスト、tsx実行形式)し通過
