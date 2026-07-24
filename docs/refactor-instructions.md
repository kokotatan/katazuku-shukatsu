# katazuku リファクタリング指示書(実装担当モデル向け)

作成: 2026-07-24 / 調査ベース: コミット `0282bf3`(MiniPC常時稼働への移行計画(spec15))

この文書は「調査担当」が実コードを読んで書いた作業指示です。実装担当はこの文書の
Implementation Phases を上から順に実行してください。**曖昧なところは推測で決めず、
Stop And Ask Conditions に従って停止し、質問してください。**

---

## Objective

既存の挙動を一切壊さずに、次の3点を達成する。

1. **同じことが複数箇所に書かれている状態を減らす**(アプリ間コピー、DBパス解決、検証ハーネス)
2. **責務の所有者をはっきりさせる**(スキーマ定義、トランザクション、CLIとライブラリの境界)
3. **今後の変更で壊れたときに気づける網を増やす**(型検査、運用不変条件のlint、壊れたテストの修理)

目的は「見た目をきれいにすること」ではない。**変更しやすさと、事故ったときの検知力を上げること**。
古いコードを一律に悪と決めつけない。証拠(呼び出し元・テスト・ドキュメント)なしに大きな削除や
全面書き換えをしない。

---

## Project Understanding

### これは何か

就活生1人(リポジトリ所有者本人)のための「就活の自動運転」基盤。ユーザーは本人ただ一人。
ルーチン(メール処理、選考ステータス追跡、日程・会議、面接記録、企業研究、応募)を自動化し、
本人は「考える・受ける・認証する・決める」だけに集中する。あわせて「何を・何のために・
どうしたか」を後から確認できる状態(活動ログ)を常に保つ。

### データフローの中心(証拠: `AGENTS.md`, `docs/specs/08-data.md`, `docs/INFRA.md`)

```
入力6本(メール / 本人との会話 / 面接録音 / 提出結果 / カレンダー / 企業研究)
        |
        v
 data/katazuku.db  (正本・ローカルSQLite・node:sqlite・gitignore・書き手はagentのみ)
        |
        +--> sync/scripts/db-snapshot.ts --> data/snapshot.json --> api/push.ts
        |         --> Vercel Private Blob --> api/data.ts (?key=合言葉) --> 8アプリ
        |
        +--> sync/scripts/db-mirror.ts --> mirror-out.json --> MCPでGoogleシート(一方向ミラー)
        |
        +--> sync/scripts/photo-sync.ts --> Private Blob private-photos/* --> api/photo.ts
```

### 主要エントリーポイント

| 種別 | 実体 |
|---|---|
| ルートビルド/検証 | `package.json` の `build` / `check` / `check:local-login` |
| 正本DBの中核 | `sync/src/db.ts`(openDb, transition, resolveCompany, addAppointment ほか) |
| 追加スキーマ | `sync/src/platform.ts`(ensurePlatformSchema), `sync/src/application.ts`(ensureApplicationSchema) |
| DB入力CLI | `sync/scripts/db-apply*.ts`(mail / interview / submission / calendar / research / person) |
| 配信 | `sync/scripts/db-snapshot.ts`, `api/push.ts`, `api/data.ts`, `api/photo*.ts` |
| ミラー | `sync/scripts/db-mirror.ts`(+ 旧エンジン `sync/src/sheet.ts`, `sync/scripts/sheet-sync.ts`) |
| モデル非依存実行基盤 | `sync/src/agent-runtime.ts` + `scripts/invoke-agent.ps1` + `sync/scripts/agent-runner.ts` |
| 定常タスク | `scripts/*.ps1` + `scripts/run-*.vbs` + `scripts/register-*.ps1`(Windowsタスクスケジューラ) |
| 資格情報ブローカー | `scripts/local-login/`(broker.mjs / lib.mjs / store-credential.ps1 ほか。spec13) |
| 人間用UI | `inbox` `status` `insight` `profile` `people` `prep` `impact` `board` + `landing` + `shared`(`@katazuku/data`) |

### 主要ワークフロー(実運用)

- `scripts/daily-sync.ps1`(毎朝8:23、タスク `katazuku-daily-sync`): Gmail → 選考差分・mail_item・
  submission → DB → snapshot → シートミラー。**現行の本番はこの v1。**
- `scripts/daily-sync-v2.ps1`: spec14 Phase B の「抽出(read-only厳格JSON)→決定論apply」版。
  **実装済みだがタスク未登録**(`scripts/register-daily-sync.ps1` は v1 を登録する)。移行途中。
- `scripts/calendar-sync.ps1`(30分毎)、`scripts/asa-auto.ps1`(9:00)、`scripts/mail-watch.ps1`(毎時)、
  `scripts/meeting-autopilot.ps1`(5分毎、meeting_run 状態機械)。
- `scripts/local-login/daily-login.ps1`: 資格情報ブローカー経由の日次ログイン。

### 外部依存

Vercel(ホスティング+Functions+Private Blob)、Google(Sheets/Gmail/Calendar/Drive、MCP経由)、
Windows タスクスケジューラ、Windows DPAPI(資格情報の暗号化)、Chrome DevTools Protocol
(ブローカーの検証)、Whisper ローカル(面接文字起こし)、Claude/Codex CLI(agent-runtime)。
アプリ側は Vite + React 19 + TS + Tailwind v4 + smarthr-ui。sync は **依存ゼロ**(devDepsのみ)。

### 現在の検証コマンドと実測ベースライン(2026-07-24 に調査担当が実行、すべて成功)

| コマンド | 結果 |
|---|---|
| `cd sync; npx tsx scripts/check-db.ts` | exit 0 |
| `cd sync; npx tsx scripts/check-sheet.ts` | exit 0 |
| `cd sync; npx tsx scripts/check-application.ts` | exit 0(21件成功) |
| `cd sync; npx tsx scripts/check-mobility.ts` | exit 0(15件成功) |
| `cd sync; npx tsx scripts/check-agent-runtime.ts` | exit 0(23件成功) |
| `cd sync; npx tsx scripts/check-daily-sync-apply.ts` | exit 0(全件成功) |
| `node scripts/local-login/check.mjs` | exit 0(32項目成功) |
| `npm run build` | **未実行**。実装担当が Phase 1 で必ず記録すること |

アプリ内の `*/scripts/check-*.ts` は `npm run build` に組み込まれていない。個別に実行した結果:

| スクリプト | 結果 |
|---|---|
| `inbox/scripts/check-classify.ts` | **失敗(exit 1)**。`inbox/gmail-import-2026-06-11.json` が無い(gitignore済の個人データ依存) |
| `inbox/scripts/check-pipeline.ts` | 成功 |
| `status/scripts/check-import.ts` / `check-sheet.ts` | 成功 |
| `insight/scripts/check-aggregate.ts` | 成功 |
| `profile/scripts/check-count.ts` | 成功 |
| `people/scripts/check-people.ts` | 成功 |
| `prep/scripts/check-prep.ts` | 成功 |
| `impact/scripts/check-metrics.ts` | 成功 |

### 重要: 調査中に別セッションの作業が入った

調査開始時(13:30)の作業ツリーは clean だったが、13:34-13:39 に別のセッションが次を変更した。

```
 M sync/package.json
 M sync/scripts/check-db.ts
 M sync/scripts/db-apply-calendar.ts
 M sync/src/db.ts                      (findAppointmentMatch / normalizeAppointmentAt 等を追加)
?? sync/scripts/check-duplicate-appointments.ts
?? sync/calendar-import-loop.json       (個人カレンダーデータ。gitignore対象外。後述 D16)
?? =                                    (0バイトの誤生成ファイル)
```

内容は「カレンダー由来とメール由来で同じ会議が2行に割れる不具合」の修正。**進行中の他人の作業**である。
実装担当は最初に `git status` を確認し、**これらの未コミット変更と自分の変更を混ぜてはいけない**。
まだ残っていたら Stop And Ask(質問A)。

---

## Behaviors To Preserve

以下は「壊したら実害が出る」既存挙動。リファクタで変えてはいけない。

1. **選考ステータス遷移規則**: `sync/src/db.ts` の `transition()` に集約。終了系(不合格/辞退)は
   根拠があれば確定・終了からの復活なし・手書きの詳細ステータスを粗い進行中で潰さない・
   「辞退予定」は内定でも上書きしない。`outcomeOf()` の判定語彙も含めて現状維持。
2. **名寄せ規則**: `sameCompany`(NFKC正規化、部分一致は両方4文字以上)、`samePosition`(完全一致
   または両方4文字以上の包含)、`resolveCompany` の hit/suspicious/new の3分岐と `pending_review` 送り。
3. **暴走ブレーキ**: `db-apply.ts` の `MAX_APPLY_CHANGES = 15`(`--force` で解除)、
   `sync/scripts/sheet-sync.ts` の同名定数。閾値も挙動も変えない。
4. **失敗の隔離**: `daily-sync-apply.ts` / `db-apply-mail.ts` は、1件の名寄せ失敗で同期全体を
   巻き戻さない(2026-07-22の実バグ修正)。この「部分適用でも他を止めない」意味論を保つ。
5. **snapshot に出してはいけないもの**: `company.password`、`data:image/*`、住所・緯度経度・
   移動履歴。`db-snapshot.ts` と `platform.ts` の `stripImages` / `listMobilityData` の除外に依存。
6. **シートミラーのパスワードマスク**: `db-mirror.ts` の `PASSWORD_MASK`(［保護済］)と、
   `db-import-sheet.ts` の再取込ガード(マークを実パスワードとして取り込まない)。
7. **資格情報ブローカーの安全境界**: 秘密値を親プロセスへ返さない / 標準出力・エラーログに出さない /
   MFA・CAPTCHA検出時は復号前に停止 / origin 一致 + `allowed_url_prefix`(テナントパス)照合 /
   fixture サーバは 127.0.0.1 限定バインド。`scripts/local-login/check.mjs` の32項目が仕様。
8. **meeting_run 状態機械**: 予定ID単位で armed → opened → recording → stopping → digesting → done。
   一回限り実行の保証(`db-meeting-run.ts` の ensure/transition)。
9. **agent-runtime のフォールバック境界**: `mayFallback()`。外部副作用の開始後は別providerへ
   フォールバックしない。`classifyFailure()` の「起動前失敗(command_missing 等)は安全」という分類。
10. **provider直呼び禁止lint**: `check-agent-runtime.ts` の `KNOWN_DIRECT`(8本の未移行スクリプト)。
    移行していないのに外す、移行したのに残す、のどちらもテストが落ちる設計。この網を弱めない。
11. **完了センチネル方式**: `daily-sync.ps1` は `=== daily-sync DONE ===`(ASCII)の有無だけで
    成否判定する。日本語「完了」も旧ログ互換で許容。ここを変えると誤報が再発する。
12. **アプリの表示**: SmartHR Design System 準拠の見た目(本人が気に入っている)。
    リファクタでレイアウト・配色・文言を変えない。
13. **`data/` `logs/` `credential-store/` `*.local.md` `.env` の非コミット**。

---

## Non-Negotiables

- **絵文字は全面禁止**(UI・コード・コミットメッセージ・この種のドキュメントすべて)。
  アイコンが必要なら smarthr-ui の `Fa*Icon`。
- **個人情報の境界**: `data/`(正本DB)、`logs/`、`credential-store/`、`*.local.md`、`.env`、
  `mirror-out.json`、`*-import-*.json` はコミットしない。中身を出力・貼り付けもしない。
  新しい生成物パターンを作ったら必ず `.gitignore` に追記する。
- **正本DBはSQLite、書き手はagentのみ**。人がシートを直接編集する前提のコードを足さない。
- **ステータス更新は `transition()` 経由**。機械的な上書きを新規に足さない。
- **UI文言・コードコメント・コミットメッセージは日本語**。
- **検証スクリプトは `sync/scripts/check-*.ts`(tsx実行・依存ゼロの自前assert形式)に揃える**。
  新しいテストフレームワーク・新しい実行時依存を導入しない(sync は依存ゼロが設計方針)。
- **コミットは機能単位で、ビルド+全テスト通過後に**。この作業では**コミットしてよいのは
  フェーズ単位まで**とし、`git push` は行わない。
- 本人が受験すべきもの(Webテスト・コーディングテスト)に触れる自動化を足さない。

---

## Stop And Ask Conditions

次に当たったら**手を止めて質問する**。勝手に決めない。

1. 未コミットの他人の変更が残っている / 途中で新たに増えた(混線の危険)。
2. 削除候補のコードが本当に不要か、呼び出し元・ドキュメント・テストのいずれからも確定できない。
3. 公開API(`api/*.ts`)、DBスキーマ、`data/katazuku.db` の保存済みデータに影響しうる。
4. 認証・秘密情報・外部連携(Vercel Blob、Google MCP、資格情報ブローカー、Windowsタスク登録)の
   挙動が変わりうる。
5. テストと実装が矛盾している(どちらが正か判断できない)。
6. 互換性を壊しうる(環境変数名、CLIの引数、出力JSONの形、localStorageキー)。
7. 設計案が複数あり、プロダクト判断が必要(例: 旧シートエンジンを消すのか残すのか)。
8. 1フェーズの差分が大きくなりすぎた(目安: 変更ファイル15超、または挙動確認が必要な箇所が3つ超)。

質問するときは「何が分からないか / 選択肢 / それぞれの影響 / 自分の推奨」を1回でまとめて出す。

---

## Baseline Commands

作業開始前と各フェーズ後に必ず実行し、結果(exit code と最終行)を記録する。

```powershell
# 0. 状態確認(最初に必ず)
git status
git log --oneline -5

# 1. sync の全チェック(速い。フェーズごとに毎回)
cd sync
npx tsx scripts/check-db.ts
npx tsx scripts/check-sheet.ts
npx tsx scripts/check-application.ts
npx tsx scripts/check-mobility.ts
npx tsx scripts/check-agent-runtime.ts
npx tsx scripts/check-daily-sync-apply.ts
cd ..

# 2. 資格情報ブローカー(Chrome を headless で起動する。約30秒)
node scripts/local-login/check.mjs

# 3. フルビルド(アプリ8本の install + build + sync全チェック。時間がかかる)
npm run build
```

注意:

- `npm run build` は `inbox status insight profile people prep impact board` の順に
  `npm install` と `vite build` を回し、`scripts/assemble.mjs` で `dist/` を組み立て、
  最後に `npm run check` を回す。**アプリを触るフェーズでは必ず最後に1回通す。**
- `node scripts/local-login/check.mjs` は `C:\Program Files\Google\Chrome\Application\chrome.exe`
  を直接起動する(パスはハードコード)。Chrome が無い環境では失敗する。
- チェックスクリプトはすべてインメモリSQLite(`:memory:`)またはテンポラリで動くので、
  正本DB `data/katazuku.db` は書き換えない。**正本DBを書き換えるコマンド
  (`db-apply*`, `db-snapshot`, `db-mirror`)はこの作業では実行しない。**

---

## Debt Map

各項目に「今実装してよい(Do)」「提案のみ・要確認(Ask)」を明記した。**Ask のものは実装しない。**

---

### D1. アプリ間のコピー同期(バイト一致の重複)  — 判定: Do(Phase 5)

- **根拠**: `md5sum` 一致を確認済み。
  - `src/components/AppNav.tsx`: inbox/status/insight/profile/people/prep/impact の**7本すべて同一**(118行)
  - `src/components/DataState.tsx`: 6本同一(41行)
  - `src/lib/useKatazukuData.ts`: 6本同一(31行)
  - `src/index.css`: 7本同一、`impact/src/index.css` だけ**コメント1行が drift**
    (「inbox/status/insight/profile/prep で同一内容を保つこと」対「…/impact で」)
  - `src/lib/image.ts`: status/profile/people の3本が**微妙に異なる**(maxPx の想定が違う)
  - `src/lib/names.ts`: people/prep の2本同一
- **なぜ負債**: 「同一内容を保つこと」とコメントで人間に強制している。実際に drift 済み。
  1箇所直すと7箇所直す必要があり、忘れると見た目と挙動がずれる。
- **影響範囲**: アプリ8本の UI。ビルド設定(Vite の `file:../shared` 解決、Tailwind の content 走査)。
- **リスク**: 中。`@katazuku/data` は現在 `.ts` を直接 export しており(`shared/package.json` の
  `exports: "./src/index.ts"`)、tsx/JSX を含むコンポーネントを同じ形で置けるかは要検証。
  Tailwind v4 が `shared/` 内のクラス名を拾うか(`@source` 指定)も要検証。
- **改善案(段階的に)**:
  1. まず `useKatazukuData.ts`(React hookのみ、JSXなし)と `names.ts` を `shared/src/` へ移す。
  2. 通れば `DataState.tsx` → `AppNav.tsx` の順に移す。1本ずつ、1コミットずつ。
  3. `index.css` は**移さない**(Tailwind のエントリでビルド設定に直結)。代わりに drift した
     コメント1行を揃えるだけにする。
  4. `image.ts` は中身が違う。**統合しない**。差分の理由(maxPx)をコメントに残すだけにとどめる。
- **検証**: 各ステップ後に `npm run build` を通し、`dist/<app>/` が生成されることを確認。
  UI の見た目は変えないので、生成物の差はバンドル構成のみのはず。
- **注意**: 1コンポーネント移すごとにコミット。7本を一度に触らない。

---

### D2. insight / board が共通データ層を使わず独自実装を持つ — 判定: Ask

- **根拠**: `insight/src/lib/data.ts` と `board/src/lib/data.ts` は**バイト一致**(md5 `e861bd99…`、162行)。
  両アプリの `package.json` に `@katazuku/data` 依存が無い(他6アプリにはある)。
  `shared/src/index.ts` にも同等の `fetchKatazukuData` / `READ_KEY_STORAGE` がある。
- **なぜ負債**: 同じ `/api/data` を読むコードが3系統(shared / insight / board)。型定義も別物
  (`Selection` 対 `Track`、`Appointment` の形が違う)。snapshot の形が変わったとき、3箇所直す必要がある。
- **影響範囲**: insight と board の全画面。
- **リスク**: 中〜高。`data.ts` は生 snapshot を `Track` / `Master` 型へ**変換**しており
  (`parseSheetDate`、`daysLeft`、`予定` のみに絞る filter、`activities` の reverse)、
  `shared` の生に近い型とは意味論が違う。単純な置換はできない。
- **改善案**: (a) 現状維持し「変換層は各アプリの責務」と明文化する、(b) 変換関数だけ
  `shared/src/` へ移して insight/board が共有する、(c) insight/board も `@katazuku/data` の
  生の型へ寄せる(表示ロジックの書き換えを伴う)。**どれを採るかはプロダクト判断。質問B。**

---

### D3. 旧シート書き戻しエンジンが4重に存在する — 判定: Ask

- **根拠**:
  - `sync/src/sheet.ts`(209行) + `sync/scripts/sheet-sync.ts`(179行) + `sync/scripts/check-sheet.ts`(139行)
  - `status/src/lib/sheet.ts`(256行) + `status/scripts/sheet-sync.ts`(180行) + `status/scripts/check-sheet.ts`(135行)
  - `status/` 側は移設前の fork。ヘッダのコメントが `pipeline/` 時代のまま
    (「JSONキーを pipeline/service-account.json に保存」「Pipeline アプリの エクスポート で書き出したファイル」)。
  - `sync/src/sheet.ts` の冒頭コメントは「**正本はシート**」と書いてあり、現行の DB 中心方針と真逆。
  - 呼び出し元調査: `sheet-sync.ts` を起動する `.ps1` は**存在しない**。参照は
    `docs/MINIPC-SETUP.md`(パスが `status/scripts/sheet-sync.ts` のまま古い)と
    `scripts/claude-next-prompt.md` のみ。現行のシート反映は `db-mirror.ts` + MCP。
  - それでも `check-sheet.ts` は `npm run check` の先頭(`"check": "tsx scripts/check-sheet.ts"`)に
    残っており、ビルドのゲートになっている。
- **なぜ負債**: 死んでいる可能性が高いコードが約1100行あり、そのうち半分は方針と矛盾する
  コメントを持つ。新しく読む人(将来のモデル含む)が「シートが正本」と誤解する。
- **影響範囲**: 削除すればビルド設定(`sync/package.json` の `check`)とドキュメント。
  残せば読解コストのみ。
- **リスク**: 高(削除する場合)。`docs/specs/08-data.md` に「check-sheet.ts: 旧シートエンジン。
  **移行完了まで残す**」と明記されており、「移行完了」の判定は本人しかできない。
- **改善案**: 段階案を提示する。
  1. まず `status/` 側の3ファイル(fork、参照ゼロ、コメントが2世代前)を削除する。
  2. `sync/` 側は残し、`sync/src/sheet.ts` 冒頭の「正本はシート」というコメントだけを
     現状に合わせて訂正する(「旧経路。現行のミラーは db-mirror.ts」)。
  3. `sync/` 側の完全削除は「移行完了」の宣言後。
- **判断が要るので実装しない。質問C。**

---

### D4. DBパス解決の重複と環境変数名の二重化 — 判定: Do(Phase 4)

- **根拠**: `data/katazuku.db` へのパス解決が **20ファイルで個別に書かれている**。しかも2系統。
  - `KATAZUKU_DB` を読む: `db-agenda.ts` `db-alias.ts` `db-apply.ts` `db-import-sheet.ts`
    `db-inspect.ts` `db-meeting-done.ts` `db-mirror.ts` `db-snapshot.ts`(8本)
    および `scripts/local-login/read-db-credentials.mjs`, `migrate-db-credentials.ps1`
  - `KATAZUKU_DB_PATH` を読む: `daily-sync-apply.ts` `db-application.ts` `db-apply-calendar.ts`
    `db-apply-interview.ts` `db-apply-mail.ts` `db-apply-person.ts` `db-apply-research.ts`
    `db-apply-submission.ts` `db-calendar-outbox.ts` `db-import-private.ts` `db-link-calendar.ts`
    `db-meeting-run.ts` `db-mobility.ts`(13本)
  - `db-merge-tracks.ts` はどちらの環境変数も読まない(`--db` のみ)。
- **なぜ負債**: 「テスト用DBに向ける」つもりで `KATAZUKU_DB` を設定すると、半分のツールは
  従わず**正本DBを書きに行く**。正本が1つしかない設計で、その所在の決め方が2通りあるのは危険。
- **影響範囲**: sync の全CLI。運用スクリプト(`.ps1`)は環境変数を設定していないため、
  現状の本番動作は変わらない(いずれも既定パスに落ちる)。
- **リスク**: 低〜中。**互換性を壊さないこと**が条件。
- **改善案**: `sync/src/db-path.ts`(新規、10行程度)に `resolveDbPath(argv?, env?)` を1本作る。
  - 優先順位: `--db <path>` > `KATAZUKU_DB_PATH` > `KATAZUKU_DB` > 既定 `<repo>/data/katazuku.db`
  - **両方の環境変数を引き続き受け付ける**(どちらを消すかは質問D)。
  - 20ファイルの1行を差し替える。ロジックは動かさない。
- **検証**: `check-db.ts` に `resolveDbPath` の単体テストを3件足す(--db優先 / 両env / 既定)。
  加えて `KATAZUKU_DB_PATH` を一時ファイルに向けて `db-inspect.ts` が従うことを手で1回確認する
  (正本DBを触らない検証にすること)。

---

### D5. スキーマ定義の所有者が3箇所に分散している — 判定: Do(限定的。Phase 5)

- **根拠**:
  - `sync/src/db.ts` の `openDb()`: company / selection / company_alias / pending_review / event /
    appointment を CREATE し、その直後に**列存在チェック方式の ad-hoc マイグレーション**
    (`short_name` 追加、`official_name` の DROP、`outcome` 追加+GLOBによるバックフィル、
    `event.ref` 追加、`appointment.end_at` 追加)。
  - `sync/src/platform.ts` の `ensurePlatformSchema()`: profile / place / mobility / person /
    meeting_run / interview_note / submission / company_dossier / mail_item と索引群。
    **mobility 系テーブルの定義はここにあるのに、操作関数は `sync/src/mobility.ts` にある。**
  - `sync/src/application.ts` の `ensureApplicationSchema()`: application_run / application_event /
    application_material / web_assessment。**`openDb` からは呼ばれず**、`startApplication` /
    `applyApplicationEvent` / `listApplicationRuns` / `listWebAssessments` の**4箇所で個別に呼ばれる**。
    `mobility.ts` も `ensurePlatformSchema` を**6箇所で個別に呼ぶ**。
  - `SCHEMA_VERSION = 1`(`db.ts:158`)。上記の ad-hoc ALTER 群は版番号に紐づいていない。
- **なぜ負債**: 「このDBのスキーマは何か」を1箇所で読めない。新テーブルをどこに書くべきか
  規則が無い。関数を呼ぶ順序によってスキーマが揃ったり揃わなかったりする(実際には
  `openDb` が `ensurePlatformSchema` を呼ぶので実害は出ていないが、`ensureApplicationSchema`
  は `openDb` 経由では走らない)。
- **影響範囲**: sync 全体。正本DBの構造。
- **リスク**: 高(スキーマ自体を動かす場合)。**低(呼び出しの整理だけなら)**。
- **改善案(この範囲だけ実装してよい)**:
  1. `ensureApplicationSchema` を `openDb()` から呼ぶようにし、`application.ts` 内の4重呼び出しを
     1本に減らす(冪等なので挙動は変わらない)。**ただし `openDb(':memory:')` を使う既存テストが
     全部通ることを必ず確認する。**
  2. `mobility.ts` 内の6回の `ensurePlatformSchema()` 呼び出しも同様に減らす。
  3. 各スキーマ関数の冒頭に「どのテーブルを所有するか」の一覧コメントを付け、
     `docs/specs/08-data.md` の「スキーマ」節と対応が取れる状態にする。
- **やってはいけない**: テーブル定義の物理的な移動、`SCHEMA_VERSION` の変更、
  ad-hoc ALTER の versioned migration への作り替え。これは質問E。

---

### D6. `db/schema.sql`(Postgres想定)が現実と矛盾する死コード — 判定: Ask

- **根拠**: `db/schema.sql`(72行)は Postgres 構文(`bigint generated always as identity`、
  `text[]`、`timestamptz`)。冒頭に「適用: `psql "$DATABASE_URL" -f db/schema.sql`」。
  リポジトリ全体を grep しても**参照ゼロ**。一方 `docs/INFRA.md` は
  「Neon/Postgresは使っていない。**新設しない**」と明記。テーブル構造も現行SQLiteと食い違う
  (company に position/priority がある、selection に status しかない等)。
- **なぜ負債**: 「正本DBのスキーマ」を探した人が最初に見つける可能性が高いファイルが、
  実際には使われていない別設計。誤読の元。
- **影響範囲**: なし(参照ゼロ)。
- **リスク**: 低。ただし「将来Postgresへ移す時の設計メモ」として意図的に残している可能性がある。
- **改善案**: (a) 削除、(b) `docs/archive/` へ移して「不採用。現行は sync/src/db.ts + platform.ts」
  と明記。**質問F。**

---

### D7. トランザクション作法が統一されていない / 再入不可 — 判定: Do(明文化のみ)+ Ask(構造変更)

- **根拠**:
  - `sync/src/inputs.ts` の `transaction()` は `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK`。
    `db-apply-submission` `db-apply-interview` `db-apply-calendar` `db-apply-research`
    `db-apply-person` が使用。
  - `sync/scripts/db-apply.ts` の `applyDiff` だけ**生の `db.exec('BEGIN IMMEDIATE')`**(45行目)。
  - `daily-sync-apply.ts` の `applyDailySyncResult` は `applyDiff` → `applyMail` → `applySubmission`
    を**順に呼ぶ**。各関数が個別にトランザクションを張るので、3つの独立トランザクションになる。
    これは「1件の失敗で全体を巻き戻さない」という意図(2026-07-22の修正)と整合しているが、
    コード上どこにもその契約が書かれていない。
  - `transaction()` は**再入不可**。外側で `transaction()` を張った中で `applyMail()` を呼ぶと
    "cannot start a transaction within a transaction" で落ちる。
- **なぜ負債**: 契約が暗黙。将来「daily-sync 全体を1トランザクションに」と考えた人が
  素直に外側を包むと壊れる。しかもテストで検出できるとは限らない。
- **改善案(実装してよい範囲)**:
  - `inputs.ts` の `transaction()` に「再入不可。呼び出し側が外側でトランザクションを
    張ってはいけない」という契約コメントを付ける。
  - `applyDailySyncResult` に「3つのapplyは意図的に別トランザクション。1件の失敗で
    全体を巻き戻さないため」というコメントを付ける(既にある説明を関数先頭へ集約)。
  - `db-apply.ts` の生 `BEGIN IMMEDIATE` を `transaction()` に寄せる**かどうかは、
    エラー時の挙動(現状 `applyDiff` の catch 構造)を読んで等価だと確認できた場合のみ**。
    等価だと確信できなければ触らない。
- **やってはいけない**: トランザクション境界そのものの変更。質問G。

---

### D8. モジュールとCLIの混在(トップレベルで argv を読む) — 判定: Do(Phase 4、限定)

- **根拠**: `db-apply-mail.ts:26-27` ほか多数が**モジュールのトップレベルで**
  `process.argv.indexOf('--db')` を評価し `DB_PATH` を決める。さらに
  `export function applyMail(input, db: DatabaseSync = openDb(DB_PATH))` のように
  **デフォルト引数で新しいDB接続を開く**。
  `daily-sync-apply.ts` はこれらを import して `db` を明示的に渡すので実害は出ていないが、
  import しただけで別スクリプトの argv を解釈することになる。
- **対比**: `daily-sync-apply.ts:120-122` の `invokedDirectly` 判定は良い手本。
  `db-apply-mail.ts:83-84` にも同種の判定があるが、`DB_PATH` の解決はガードの外にある。
- **なぜ負債**: ライブラリとして import したときに副作用(argv解釈)がある。
  デフォルト引数の `openDb()` は、呼び手が db を渡し忘れると**別接続で別トランザクション**を
  開いてしまう。WAL + busy_timeout があるので即エラーにはならず、気づきにくい。
- **影響範囲**: `db-apply-*.ts` 群と、それらを import する `daily-sync-apply.ts` / `check-*.ts`。
- **リスク**: 低〜中。
- **改善案**: D4 の `resolveDbPath()` 導入とあわせて、
  - パス解決を**関数呼び出しに変える**(トップレベル定数をやめる)。
  - `applyXxx(input, db)` の `db` を**必須引数**にはしない(呼び出し元互換のため)。ただし
    デフォルト値を `openDb(resolveDbPath())` の**遅延評価**にし、CLI エントリからは明示的に渡す。
  - 迷ったら「デフォルト引数はそのまま、パス解決だけ関数化」の最小変更にとどめる。
- **検証**: `check-db.ts` / `check-daily-sync-apply.ts` が通ること。

---

### D9. 検証ハーネスが3種類 + 絵文字がコードに残っている — 判定: Do(Phase 3 と Phase 6)

- **根拠**:
  - スタイルA(真偽値): `check-db.ts:14`, `check-sheet.ts:10`, `check-daily-sync-apply.ts:16`
    → `function check(label: string, cond: boolean, detail = '')`
  - スタイルB(コールバック+assert): `check-application.ts:24`, `check-mobility.ts:23`,
    `check-agent-runtime.ts:26` → `function check(name, fn)` + `function assert(cond, msg)`
  - スタイルC: `scripts/local-login/check.mjs` は `node:assert/strict` + 自前 `ok()`
  - **絵文字**: `check-db.ts` と `check-sheet.ts` が成功/失敗マークの絵文字を出力し、末尾に
    お祝いの絵文字を出す。`sheet-sync.ts` にも3箇所。`check-daily-sync-apply.ts` は既に
    `[OK]` / `[NG]` の ASCII に移行済み。`scripts/assemble.mjs` はチェックマーク絵文字を使う。
    (対象の実文字はコード内を直接参照すること。この指示書では絵文字を再掲しない)
  - CLAUDE.md: 「**絵文字は全面禁止(UI・コード・コミットメッセージとも)**」
    「検証スクリプトは `sync/scripts/check-*.ts`(tsx実行・依存ゼロの自前assert形式)に**揃える**」
- **なぜ負債**: 明文化された規約に違反している。かつ、テスト追加時にどちらの型で書くか迷う。
  Windows のコンソール文字コードによっては絵文字が化け、過去に「完了」が化けて誤報した
  前例(`daily-sync.ps1` のコメント参照)もある。
- **影響範囲**: 出力文字列のみ。判定ロジックは無関係。
- **リスク**: **低**。ただし `npm run build` のログを目視している運用があるので、
  `[OK]` / `[NG]` / `全件成功` に揃えて可読性を落とさないこと。
- **改善案**:
  1. (Phase 3、安全な整理)`check-db.ts` `check-sheet.ts` `sheet-sync.ts` `assemble.mjs` の
     絵文字を `[OK]` / `[NG]` / `完了` 等の ASCII 相当へ置換する。**判定ロジックは1文字も触らない。**
  2. (Phase 6)共通ハーネス `sync/scripts/_check.ts`(依存ゼロ、20行程度)を作り、
     スタイルAとBの両方の呼び出し形を提供する。既存6本を**1本ずつ**移す。
     `scripts/local-login/check.mjs` は `.mjs` かつ別領域なので**移さない**。
- **検証**: 各スクリプトの exit code と「◯件成功 / ◯件失敗」の集計が変わらないこと。
  失敗時に非ゼロで終わることを、意図的に1件失敗させて確認してから元に戻す。

---

### D10. sync に tsconfig が無く、型検査が一度も走らない — 判定: Do(検出まで。Phase 2)

- **根拠**: `ls sync/tsconfig*` → 存在しない。`sync/package.json` の scripts はすべて `tsx`。
  `tsx` は型を**剥がすだけ**で検査しない。`npm run build` のアプリ側は `tsc --noEmit && vite build`
  で検査されるが、**正本DBを扱う sync だけ検査されていない**。
- **なぜ負債**: 型の誤りが実行時まで露見しない。`sync/src` には `as Record<string, unknown>` の
  キャストが多く(`db.ts` の `listSelections` など)、型の安全網が実質ゼロ。
- **影響範囲**: sync 全体。
- **リスク**: 中。**既存コードに型エラーが多数出る可能性がある**。出た場合、それを直すのは
  この作業の範囲外(別作業)。
- **改善案(段階を守る)**:
  1. `sync/tsconfig.json` を追加(アプリ側と同等の `strict: true`、`noEmit: true`、
     `moduleResolution: "bundler"`、`include: ["src", "scripts"]`。`lib` に DOM は不要)。
  2. `npx tsc --noEmit -p sync` を**手で1回だけ実行**し、エラー件数と内訳を記録する。
  3. **エラーが0件なら** `sync/package.json` に `"typecheck": "tsc --noEmit"` を足し、
     ルート `check` の先頭へ入れる。
  4. **エラーが1件でもあれば、ビルドには組み込まず**、件数と代表例を報告して停止する(質問H)。
     型エラーの修正を勝手に始めない。
- **検証**: `npm run build` が従来どおり通ること。

---

### D11. アプリ側の死コードと localStorage 正本の残骸 — 判定: Ask

- **根拠**: 各アプリ内で `src/` から一度も import されていないファイル(調査済み):
  - inbox: `lib/classify.ts` `lib/demo.ts` `lib/gmail.ts` `lib/pipeline.ts` `lib/storage.ts`、
    `components/EmailCard.tsx` `Header.tsx` `ReplyModal.tsx` `SettingsModal.tsx` `Sidebar.tsx`
  - status: `lib/demo.ts`、`components/CompanyCard.tsx` `CompanyModal.tsx` `SheetSyncModal.tsx`
  - insight: `lib/aggregate.ts` / profile: `lib/count.ts` `components/BasicProfileForm.tsx`
  - people: `components/PersonDetail.tsx` `PersonDialog.tsx` / prep: `lib/select.ts`
  - impact: `lib/metrics.ts` `lib/storage.ts`
- **ただし**: これらの多くは**アプリ内の `scripts/check-*.ts` から参照されている**
  (`inbox/scripts/check-classify.ts` など)。つまり「テストはあるが本体からは使われていない」。
- **さらに**: `people/src/lib/people.ts` は `localStorage` へ人物を保存し、`src/` から3箇所
  参照されている。`inbox/src/lib/pipeline.ts` は `katazuku-pipeline/companies` を書く。
  CLAUDE.md / INFRA.md は「正本データのlocalStorageキーは廃止。保存してよいのは
  `katazuku/read-key` だけ」と明記。**規約と実装が食い違っている可能性がある。**
- **なぜ負債**: DB中心化(2026-07-18)で役目を終えたコードが、テストごと残っている。
  どれが「意図的に残した」でどれが「消し忘れ」かは、コードからは判別できない。
- **リスク**: 高(削除する場合)。UI が壊れる/localStorage の実データが消える可能性。
- **改善案**: 実装担当は**削除しない**。代わりに「本体未参照ファイルの一覧 + それを参照する
  テストの一覧 + localStorage を書いている箇所の一覧」を報告し、本人の判断を仰ぐ。**質問I。**

---

### D12. アプリ内テストがビルドに入っておらず、1本は壊れている — 判定: Do(修理はAsk)

- **根拠**: ルート `package.json` の `check` は sync の6本と local-login のみ。
  `inbox/scripts/check-*.ts`(8本)、`status/scripts/`(3本)、`insight` `profile` `people`
  `prep` `impact` の各1〜2本は**どこからも呼ばれていない**。
  `inbox/scripts/check-classify.ts` は実行すると
  `ENOENT: ... inbox\gmail-import-2026-06-11.json`(gitignore済の個人データ)で落ちる。
- **なぜ負債**: 通らないテストが放置されると、テスト全体が信用されなくなる。
  また、個人データファイルに依存するテストは他マシンで再現できない。
- **影響範囲**: 開発時の安全網のみ。本番挙動には影響しない。
- **リスク**: 低。
- **改善案**:
  1. (Do)`inbox/scripts/check-classify.ts` の先頭に「個人データ依存のため既定では実行できない」
     旨のコメントと、ファイルが無い場合の**明示的なスキップ + 非ゼロ終了しない**扱いを入れる
     …のは挙動変更なので**まずは事実の報告にとどめる**。
  2. (Ask)アプリ内テストをルート `check` に組み込むか、削除するか、現状維持か。**質問J。**

---

### D13. `register-*.ps1` が INFRA.md の必須要件を満たしていない(再登録で無言退行) — 判定: Do(Phase 3、優先度高)

- **根拠**: `docs/INFRA.md` は
  「**全タスクにバッテリー起動を許可すること**(`-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`)。
  既定は『バッテリー駆動なら起動しない/切替時に停止』で、電源を外した瞬間に**無言で全自動処理が止まる**。
  2026-07-24に全タスクで発覚し解除済み」と書いている。
  しかし実際に該当フラグを持つ register スクリプトは:
  - `scripts/register-calendar-sync.ps1`(commit `b25fe03` で修正済み)
  - `scripts/register-meeting-opener.ps1`(**廃止予定の旧タスク**)
  の2本だけ。**次は未対応**: `register-asa.ps1` / `register-daily-sync.ps1` /
  `register-mail-watch.ps1` / `register-meeting-autopilot.ps1` / `register-local-login.ps1`。
  `b25fe03` の差分は `register-calendar-sync.ps1` と `INFRA.md` のみ(既存タスクの設定は
  ad-hoc コマンドで直したと読める)。
- **なぜ負債**: 「直した」のは**動いているタスクの設定**であって、**それを作るスクリプト**では
  ない。`register-all-tasks.ps1` を再実行すると `-Force` で上書き登録され、**修正が消える**。
  同じ事故(2026-07-24に実害あり)が再発する。
- **影響範囲**: Windows タスクスケジューラの5タスク。自動運転全体の稼働。
- **リスク**: **低**。register スクリプトは実行しない限り何も起きない。1行の追記のみ。
- **改善案**:
  1. 未対応5本の `New-ScheduledTaskSettingsSet` に `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`
     を追加し、`register-calendar-sync.ps1` と同じ理由コメントを付ける。
  2. `sync/scripts/check-agent-runtime.ts` の `KNOWN_DIRECT` lint と同じ要領で、
     **`scripts/register-*.ps1` を走査して両フラグの有無を検査するテスト**を追加する
     (`register-all-tasks.ps1` のようにタスクを直接登録しないものは除外)。
     置き場所は `check-agent-runtime.ts` が既に `scripts/*.ps1` を走査しているのでそこが自然。
- **重要**: **register スクリプトを実行してはいけない**(タスクを実際に登録し直してしまう)。
  検証はテキスト検査と新規テストのみ。
- **検証**: 追加したテストが、フラグを1本抜いたときに落ちることを一度確認してから戻す。

---

### D14. 廃止済み `meeting-opener` 一式が残っている — 判定: Ask

- **根拠**: `docs/INFRA.md`「旧 `katazuku-meeting-opener` はmeeting-autopilotと二重起動するため
  無効化する」。`scripts/register-meeting-autopilot.ps1` は登録時に
  `Disable-ScheduledTask -TaskName 'katazuku-meeting-opener'` を実行する。
  それでも `scripts/register-meeting-opener.ps1`、`scripts/run-meeting-opener.vbs`、
  `scripts/open-meeting-urls.ps1`(178行)が残っている。
  `open-meeting-urls.ps1` は `check-agent-runtime.ts` の `KNOWN_DIRECT`(未移行の直呼び)にも載っている。
- **なぜ負債**: 誤って `register-meeting-opener.ps1` を実行すると、meeting-autopilot と
  **二重に会議URLを開き録音も二重起動**しうる。危険な残骸。
- **リスク**: 削除すると `KNOWN_DIRECT` から1本外すことになり、lint の想定と噛み合わせる必要がある。
- **改善案**: (a) 3ファイル削除 + `KNOWN_DIRECT` から `open-meeting-urls.ps1` を除去、
  (b) `register-meeting-opener.ps1` の先頭に「廃止。実行しないこと」のガード
  (`throw` で即停止)を入れて残す。**質問K。**

---

### D15. daily-sync が v1 / v2 の二重系統 — 判定: Do(明文化のみ)

- **根拠**: `scripts/daily-sync.ps1`(現行本番、`register-daily-sync.ps1` が登録)と
  `scripts/daily-sync-v2.ps1`(spec14 Phase B、未登録)。
  **両者は同じ `logs/alert-daily-sync.txt` に書き、同じ `=== daily-sync DONE ===` を出す。**
  v2 は成功時に alert ファイルを削除する。
- **なぜ負債**: 両方が動く状況になると、片方の失敗アラートをもう片方が消す。
  ファイル名からは v1/v2 の区別が付かない。
- **リスク**: 現状は v2 が未登録なので実害なし。**移行中の資産なので削除は厳禁。**
- **改善案(実装してよい範囲)**: v1・v2 双方のヘッダコメントに
  「現在の本番は v1(register-daily-sync.ps1 が登録)。v2 は Phase B の移行先で未登録。
  両方を同時に登録しないこと(alert ファイルを共有しているため)」を明記する。
  ファイル名・alert パス・センチネル文字列は**変えない**(D15の変更は質問L)。

---

### D16. `.gitignore` の抜けと作業ツリーのゴミ — 判定: Do(Phase 3、優先度高)

- **根拠**:
  - `sync/calendar-import-loop.json`(4991バイト、カレンダー取込データ)は
    `git check-ignore` で**マッチしない**(exit 1)。既存パターンは
    `sync/research-*-loop.json` `sync/application-*-loop.json` `sync/mail-import-*.json`
    `sync/submission-import-*.json` `sheet-import-*.json` のみで、`calendar-import-*` が無い。
    現在 untracked のまま存在しており、`git add -A` で**個人カレンダーデータがコミットされうる**。
  - リポジトリ直下に `=` という 0 バイトのファイルがある(誤ったリダイレクトの産物)。
- **なぜ負債**: 個人情報の境界が最重要要件なのに、生成物のパターン網に穴がある。
- **リスク**: 低(追記のみ)。
- **改善案**:
  1. `.gitignore` に `sync/calendar-import-*.json` を追加する。ついでに既存の取込系パターンを
     1箇所にまとめてコメントを付ける(**パターンの意味は変えない**)。
  2. `=` の削除は**他セッションが作った可能性がある**ため、勝手に消さず報告する(質問A に含める)。
- **検証**: `git check-ignore -v sync/calendar-import-loop.json` が該当行を返すこと。
  既存の追跡済みファイルが新たに ignore されていないこと(`git status` に削除が出ないこと)。

---

### D17. `/api/data` の読み取り認証と CORS — 判定: Ask(実装禁止)

- **根拠**: `api/data.ts` はクエリ `?key=` と `KATAZUKU_READ_SECRET` の**単純文字列比較**のみ。
  `Access-Control-Allow-Origin: *` を返す。合言葉はブラウザ(localStorage `katazuku/read-key`)に
  置かれ、失効もスコープもない。snapshot には面接メモ・人物名・プロフィール・メール要約が含まれる
  (`platform.ts` の `listPlatformSnapshot`)。
  `docs/specs/08-data.md` の「クラウドへ出ている個人データと読み取り認証の現状(2026-07-22 追記・要判断)」
  に**既に本人判断待ちとして記録されている**。
- **なぜ負債**: CLAUDE.md の「配信物に個人データを含めない」という自己規定と食い違う。
  ただし単一ユーザー前提での利便性トレードオフとして意図的に選ばれている可能性が高い。
- **リスク**: 高。認証を変えると全アプリが読めなくなる。
- **改善案(提案のみ)**: (a) 現状維持、(b) 比較を `crypto.timingSafeEqual` にする(挙動不変・低リスク)、
  (c) CORS を自ドメインに絞る、(d) 機微データを snapshot から外す、(e) 短命署名URL化。
  **(b) と (c) は小さいが、認証・外部連携に触るため Stop And Ask 条件4に該当する。質問M。**

---

### D18. `agent-runtime.ts` が1ファイルに5つの責務を持つ — 判定: Do(Phase 4、慎重に)

- **根拠**: `sync/src/agent-runtime.ts` は 31KB / 約800行。含むもの:
  (1) provider定義と順序解決、(2) 失敗分類 `classifyFailure` とフォールバック判定 `mayFallback`、
  (3) 子プロセス実行 `executeProcess`(Windows の `.cmd` ラップ、タイムアウト、stdin の EPIPE 対策)、
  (4) **自前 JSON Schema バリデータ** `validateJsonSchema`(約80行、$ref/allOf/anyOf/oneOf対応)、
  (5) アダプタ生成 `createCodexAdapter` / `createClaudeAdapter` と capability→tool マップ、
  (6) `runAgent` の本体(artifact保存、リダクション、リトライ)。
- **なぜ負債**: 責務が違うものが1ファイルにあるため、片方を読むのに全体を読む必要がある。
  特に `validateJsonSchema` は agent とは独立した汎用ロジックで、
  `daily-sync-apply.ts` からも import されている(agent-runtime 経由で schema 検証している)。
- **影響範囲**: agent-runtime を import するのは `agent-runner.ts` `agent-doctor.ts`
  `daily-sync-apply.ts` `check-agent-runtime.ts`。
- **リスク**: 低〜中。**テストが23件あり安全網として十分**。
- **改善案**: **純粋な移動のみ**。1ファイルずつ、1コミットずつ。
  1. `sync/src/json-schema.ts` へ `validateJsonSchema` / `schemaTypeMatches` / `resolveSchemaRef` を移し、
     `agent-runtime.ts` は re-export する(既存 import を壊さない)。
  2. 通れば `sync/src/process-exec.ts` へ `executeProcess` / `quoteForCmd` を移す(同様に re-export)。
  3. 3つ目以降は様子を見て停止する。**ロジックは1行も変えない。**
- **検証**: `check-agent-runtime.ts`(23件)と `check-daily-sync-apply.ts` が通ること。
  `npm run build` が通ること。

---

### D19. `api/data.ts` の Blob 読み取り3経路フォールバック — 判定: 提案のみ(低優先)

- **根拠**: `api/data.ts` は `get` → `head` → `list` の3経路を順に試し、全滅時に
  `tried[]`(各経路の失敗メッセージ先頭120文字)を **404レスポンスのJSONに載せる**。
  「SDK差異に備え複数の読み方を試す」というコメントどおり、SDK バージョンが確定するまでの保険。
- **なぜ負債(軽度)**: 個人データ配信APIが、失敗時に内部の状況を返す。認証済みでないと
  到達しない(401が先)ので実害は小さい。
- **改善案**: `@vercel/blob` のバージョンが固定(`^2.6.1`)されている今、どの経路が実際に
  効いているかを1回確認し、不要な経路を落とす。ただし本番でしか確認できない。**低優先。提案のみ。**

---

### D20. ドキュメントと実装の乖離 — 判定: Do(Phase 3)

- **根拠**:
  - `CLAUDE.md`:「api/ は廃止(タグ apps-archive-20260718)」→ **誤り**。
    `api/data.ts` `api/push.ts` `api/photo.ts` `api/photo-push.ts` は現役(snapshot配信の要)。
    `docs/PROGRESS.md` の「未決」項目3にも「要更新」と記録済み。
  - `CLAUDE.md` の構成図に `landing/` の説明はあるが `shared/`(`@katazuku/data`)が無い。
  - `docs/MINIPC-SETUP.md:14,63,116` が `status/scripts/sheet-sync.ts` / `status/src/lib/sheet.ts` を
    指しており、移設後(`sync/`)のパスになっていない。
  - `sync/src/sheet.ts` の冒頭「正本はシート」(D3参照)。
  - `sync/board/src/lib/` が**空ディレクトリ**として残っている(移動の残骸)。
- **なぜ負債**: 次に読むモデル・人間が誤った前提で作業する。実際に PROGRESS へ
  「陳腐化」として記録されるほど繰り返されている。
- **リスク**: 低。
- **改善案**: 上記5点を事実に合わせて修正する。**方針の変更は書かない**(事実の訂正のみ)。
  空ディレクトリはgitに載らないので削除してよい。

---

### D21. 依存バージョンの不揃い — 判定: 提案のみ

- **根拠**: `inbox/package.json` だけ `@types/node: ^25.9.3`(他アプリには `@types/node` 無し)。
  ルートは `engines: node >=24 <25`、`.node-version` は `24.16.0`。
  sync は `@types/node: ^22.0.0`。
- **なぜ負債(軽度)**: Node 24 固定運用なのに、型定義が 22 / 25 と割れている。
  `node:sqlite` の型が版によって変わると、D10 の型検査導入時に噛む。
- **改善案**: D10 の型検査を入れるときにあわせて検討する。**単独では触らない。**

---

## Implementation Phases

**各フェーズは「小さく、戻しやすく、検証してから次へ」。1フェーズ = 1コミット を原則とする。**

### Phase 1 — 現在状態と検証コマンドの確認(コード変更なし)

1. `git status` / `git log --oneline -5` を実行し、**未コミット変更の有無を記録**する。
   この指示書作成時点(D「重要」節)の変更がまだ残っていたら **Stop And Ask(質問A)**。
2. Baseline Commands のうち、sync の6本と `node scripts/local-login/check.mjs` を実行し、
   exit code と最終行を記録する。
3. `npm run build` を1回実行し、成否と所要時間を記録する。**ここで落ちたら、原因を報告して停止する**
   (自分の変更が原因ではないため、勝手に直さない)。
4. 記録した内容を「Baseline」として報告フォーマットに残す。

### Phase 2 — 安全網を先に作る(挙動を変えない)

1. **D10**: `sync/tsconfig.json` を追加し、`npx tsc --noEmit -p sync` を実行。
   - 0件 → `sync/package.json` に `typecheck` を追加し、ルート `check` の先頭へ入れる。
   - 1件以上 → **ビルドには組み込まず**、件数と代表例3件を報告して**このステップを中断**(質問H)。
     tsconfig 自体は残してよい(手動実行できる状態にする)。
2. **D13の後半**: `scripts/register-*.ps1` のバッテリーフラグを検査するテストを
   `sync/scripts/check-agent-runtime.ts` に追加する。**この時点ではテストは落ちる**(5本未対応)。
   落ちることを確認したうえで Phase 3 に進む(=先にテスト、あとで修正)。
   - もし「先にテストが落ちる状態でコミットしたくない」なら、Phase 3 の修正と**同一コミット**にする。
3. 検証: sync の全チェック + `npm run build`。

### Phase 3 — 明らかに安全な整理

順に実施し、**それぞれ独立したコミット**にする。

1. **D16**: `.gitignore` に `sync/calendar-import-*.json` を追加。
   `git check-ignore -v` で確認。既存の追跡ファイルに影響が無いことを `git status` で確認。
2. **D13**: `register-asa.ps1` / `register-daily-sync.ps1` / `register-mail-watch.ps1` /
   `register-meeting-autopilot.ps1` / `register-local-login.ps1` に
   `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries` と理由コメントを追加。
   Phase 2-2 のテストが通ることを確認。**register スクリプトは実行しない。**
3. **D9-1**: `check-db.ts` `check-sheet.ts` `sheet-sync.ts` `assemble.mjs` の絵文字を ASCII へ置換。
   判定ロジックは触らない。exit code と件数集計が変わらないことを確認。
4. **D20**: ドキュメント5点の訂正(`CLAUDE.md` の api/ 記述、`shared/` の追記、
   `docs/MINIPC-SETUP.md` のパス、`sync/src/sheet.ts` の冒頭コメント、`sync/board/src/lib` 削除)。
5. **D15**: `daily-sync.ps1` / `daily-sync-v2.ps1` のヘッダに所有関係のコメントを追記。
6. **D7(コメントのみ)**: `inputs.ts` の `transaction()` に「再入不可」契約、
   `daily-sync-apply.ts` に「意図的に別トランザクション」の説明を追記。

検証: 各コミット前に sync の全チェック。Phase 3 の最後に `npm run build`。

### Phase 4 — 小さな責務分離(挙動不変の抽出)

1. **D4 + D8**: `sync/src/db-path.ts` に `resolveDbPath()` を新設し、20ファイルのパス解決を
   差し替える。**`KATAZUKU_DB` と `KATAZUKU_DB_PATH` の両方を受け付ける**(互換維持)。
   `check-db.ts` に単体テスト3件を追加。
   - 差し替えは**5ファイルずつ**に区切ってコミットしてよい(20本を1コミットにしない)。
2. **D18-1**: `sync/src/json-schema.ts` へ `validateJsonSchema` 群を移動し、
   `agent-runtime.ts` から re-export。ロジックは1行も変えない。
3. **D18-2**: 1 が問題なければ `sync/src/process-exec.ts` へ `executeProcess` を移動、同様に re-export。
   **3つ目以降の分割はここで止める**(効果を確認してから)。

検証: 各ステップ後に sync の全チェック。Phase 4 の最後に `npm run build`。

### Phase 5 — 境界とインターフェースの明確化

1. **D5(限定)**: `ensureApplicationSchema` を `openDb()` から呼ぶ形にし、
   `application.ts` の4重呼び出しと `mobility.ts` の6重呼び出しを整理する。
   **冪等性に依存した挙動なので、`check-application.ts` `check-mobility.ts` `check-db.ts` が
   すべて通ることを必ず確認する。** 通らなければ元に戻して報告。
2. **D5(コメント)**: 3つのスキーマ関数の冒頭に「所有テーブル一覧」を書き、
   `docs/specs/08-data.md` のスキーマ節と対応させる。
3. **D1**: アプリ共通ファイルの `shared/` への移動。**必ず1ファイルずつ**。
   `useKatazukuData.ts` → `names.ts` → `DataState.tsx` → `AppNav.tsx` の順。
   1本移すごとに `npm run build` を通す。**通らなければその1本を戻して次へ進まず報告。**
   `index.css` と `image.ts` は移さない(D1 の改善案3・4を参照)。

### Phase 6 — テストしやすい構造へ

1. **D9-2**: 共通ハーネス `sync/scripts/_check.ts` を新設し、既存6本を1本ずつ移す。
   出力形式(`[OK]` / `[NG]` / 集計行)と exit code を変えない。
   `scripts/local-login/check.mjs` は対象外。
2. 各移行後に「意図的に1件失敗させて非ゼロ終了する」ことを確認し、元に戻す。

### Phase 7 — 大きな設計変更は提案に留める(実装しない)

次は**設計案と影響範囲を文書化するだけ**。実装しない。

- D2(insight/board のデータ層統合)、D3(旧シートエンジンの扱い)、D6(`db/schema.sql`)、
  D11(アプリの死コードと localStorage 残骸)、D12(アプリ内テストの扱い)、D14(meeting-opener 残骸)、
  D17(`/api/data` の認証・CORS)、D19、D21、
  および D5 のスキーマ物理移動 / versioned migration 化、D7 のトランザクション境界変更、
  D15 の alert ファイル分離。
- 提案は `docs/refactor-proposals.md` に新規作成してまとめる(この文書は書き換えない)。

---

## Verification Requirements

- **各フェーズの終わりに必ず**: sync の6チェック(`check-db` `check-sheet` `check-application`
  `check-mobility` `check-agent-runtime` `check-daily-sync-apply`)を実行し、exit code を記録。
- **アプリまたはビルド設定を触ったフェーズ**では追加で `npm run build` を通す。
- **`scripts/local-login/` を触った場合**(この計画では触らない予定)は
  `node scripts/local-login/check.mjs` を通す。
- **新しい挙動を足したら、必ず `check-*.ts` にテストを添える**(CLAUDE.md / ROADMAP の規約)。
  新規テストは「わざと壊すと落ちる」ことを一度確認してから元に戻す。
- **正本DBを書き換えるコマンドは実行しない**(`db-apply*` `db-snapshot` `db-mirror` `photo-sync`)。
- **タスク登録スクリプトを実行しない**(`register-*.ps1`, `register-all-tasks.ps1`)。
- **外部へ送信しない**(Vercel への push、Google MCP 経由の書き込み、メール送信)。
- 差分は `git diff --stat` で毎回確認し、**意図しないファイルが混ざっていないこと**を見る。
  特に `data/` `logs/` `credential-store/` `*.local.md` `.env` が差分に出たら即停止。

---

## 作業の進め方(制約)

1. **最初に `git status` を確認する。**
2. **既存の未コミット変更と自分の変更を混ぜない。** 他人の変更が残っていたら質問して止まる。
3. **編集前に baseline の検証結果を記録する**(Phase 1)。
4. **変更は小さく戻しやすい単位にする。** 1フェーズ = 1コミット(大きければ分割)。
5. **無関係な整形・ついでのリファクタリングをしない。** 行末空白の除去、import の並べ替え、
   フォーマッタの一括適用は禁止。触った行だけを変える。
6. **既存挙動を勝手に変えない。** 出力文字列を変えてよいのは D9(絵文字→ASCII)だけ。
7. **正しさが不明な場合は実装を止めて質問する。**
8. **各フェーズごとに検証する。** 落ちたら次へ進まず、その変更を戻してから報告する。
9. **最後に、実行したコマンドと結果をすべて報告する。**
10. コミットメッセージは日本語1行要約(+必要なら本文)。絵文字を使わない。
    `git push` はしない。

---

## Reporting Format

作業完了時、次の形式で報告する。

```
## 実行結果サマリ

- 完了したフェーズ: Phase 1 / 2 / 3 ...
- 作成したコミット: <hash> <要約>(フェーズ対応)
- 停止した箇所と理由(あれば)

## Baseline(Phase 1 で記録)

| コマンド | exit | 最終行 |
|---|---|---|
| ... | ... | ... |

## フェーズごとの検証結果

### Phase N: <名前>
- 変更ファイル: <git diff --stat の要約>
- 実行したコマンドと結果:
  - `cd sync; npx tsx scripts/check-db.ts` -> exit 0
  - ...
- 気づいたこと・想定と違ったこと

## 未実施 / 提案に留めた項目

- D番号ごとに、なぜ実装しなかったか(質問待ち / リスク超過 / 範囲外)

## 実装前に確認が必要な質問(残っているもの)

- 質問A〜M のうち未回答のもの
```

---

## Out-of-scope Items

以下はこのリファクタでは**触らない**。

- **アプリの見た目・レイアウト・文言の変更**(SmartHR Design System 準拠を維持)。
- **正本DBのデータ移行・破壊的マイグレーション・`SCHEMA_VERSION` の変更**。
- **`transition()` の遷移規則、`sameCompany` / `samePosition` の名寄せ規則の変更**。
- **`/api/*` の認証方式・CORS・レスポンス形の変更**(D17 は提案のみ)。
- **資格情報ブローカー(`scripts/local-login/`)の照合ポリシー・暗号化・停止条件の変更**。
  セキュリティ境界であり、変更は本人方針確認が要る(spec13)。
- **daily-sync v2 への切り替え、タスクスケジューラへの登録・変更**(spec14 Phase B の本線作業)。
- **MiniPC移行(spec15)、応募自動運転(spec11)、移動を含む日程調整(spec12)の機能実装**。
- **新しい実行時依存・テストフレームワーク・ビルドツールの導入**(sync の依存ゼロ方針)。
- **`docs/PROGRESS.md` の過去記録の書き換え**(追記は可、履歴の改変は不可)。
  過去記録に残る絵文字も、履歴なので**そのままにする**。
- **`git push` / デプロイ / 外部サービスへの書き込み**。
- **本人しかできない作業**(Windowsタスクの実登録、Google認証、鍵の配置、Webテスト受験)。

---

## 実装前に確認すべき質問(本人・依頼者へ)

**A. 進行中の他セッションの変更をどう扱うか(最優先)**
2026-07-24 13:34-13:39 に別セッションが `sync/src/db.ts` `sync/scripts/check-db.ts`
`sync/scripts/db-apply-calendar.ts` `sync/package.json` を変更し、
`sync/scripts/check-duplicate-appointments.ts` と `sync/calendar-import-loop.json` を追加した
(予定重複の突合修正)。加えてリポジトリ直下に 0 バイトの `=` というファイルがある。
リファクタ着手前に、これらをコミットするか / 退避するか / 完了を待つか。`=` は削除してよいか。

**B. insight / board のデータ層(D2)**
両者が持つバイト一致の `lib/data.ts` は、`@katazuku/data` へ寄せるか、各アプリの変換層として
残すか。寄せる場合、`Track` / `Master` 型への変換ロジックも `shared/` に置いてよいか。

**C. 旧シート書き戻しエンジン(D3)**
`status/src/lib/sheet.ts` / `status/scripts/sheet-sync.ts` / `status/scripts/check-sheet.ts`
(参照ゼロ、コメントが `pipeline/` 時代のまま)は削除してよいか。
`sync/` 側(`src/sheet.ts` + `scripts/sheet-sync.ts` + `check-sheet.ts`)は spec08 に
「移行完了まで残す」とあるが、**移行完了の判定基準は何か**。まだ残すなら現状維持でよいか。

**D. DBパス環境変数(D4)**
`KATAZUKU_DB` と `KATAZUKU_DB_PATH` の2系統がある。両方を受け付ける形に統一したうえで、
将来的にどちらへ寄せるか(推奨: 新しい方の `KATAZUKU_DB_PATH` を正、`KATAZUKU_DB` は後方互換)。
`scripts/local-login/read-db-credentials.mjs` と `migrate-db-credentials.ps1` も
`KATAZUKU_DB` を使っているため、統一するならこれらも対象になる。

**E. スキーマ定義の物理的な整理(D5)**
テーブル定義を `db.ts` / `platform.ts` / `application.ts` の3箇所から
「1ファイル1ドメイン」へ物理的に移すのは、今やるべきか、`SCHEMA_VERSION` の
versioned migration 化とあわせて別作業にするか。

**F. `db/schema.sql`(D6)**
参照ゼロの Postgres スキーマ。削除してよいか、将来の設計メモとして
`docs/archive/` へ移して「不採用」と明記するか。

**G. トランザクション境界(D7)**
`daily-sync-apply.ts` が3つの apply を別トランザクションで走らせているのは意図どおりか
(1件失敗しても他を止めない設計)。`db-apply.ts` の生 `BEGIN IMMEDIATE` を
`transaction()` に寄せてよいか(エラー時の挙動が等価か確認したうえで)。

**H. sync の型検査(D10)**
`tsc --noEmit` で既存の型エラーが出た場合、(a) ビルドに組み込まず手動実行に留める、
(b) 型エラーの修正を別作業として起票する、(c) いま直す、のどれを選ぶか。

**I. アプリの死コードと localStorage 残骸(D11)**
本体から未参照のファイル(inbox の `classify.ts` `gmail.ts` `pipeline.ts` `EmailCard.tsx` ほか、
status の `SheetSyncModal.tsx` ほか、計約20ファイル)は削除してよいか、意図的な保存か。
また `people/src/lib/people.ts` と `inbox/src/lib/pipeline.ts` が localStorage を書いているのは、
「正本データのlocalStorageキーは廃止」という規約に照らして残ってよいものか。

**J. アプリ内テスト(D12)**
`inbox/scripts/check-classify.ts` は gitignore 済みの個人データ
(`inbox/gmail-import-2026-06-11.json`)に依存していて現在**失敗する**。
アプリ内の check スクリプト(計14本)は、ルートの `check` に組み込むか、削除するか、
現状のまま(手動実行)にするか。

**K. 廃止済み meeting-opener(D14)**
`scripts/register-meeting-opener.ps1` / `run-meeting-opener.vbs` / `open-meeting-urls.ps1` は
削除してよいか、実行ガード(先頭で `throw`)を付けて残すか。削除する場合、
`check-agent-runtime.ts` の `KNOWN_DIRECT` から `open-meeting-urls.ps1` を外す。

**L. daily-sync v1/v2 の alert 共有(D15)**
両者が `logs/alert-daily-sync.txt` と同じ完了センチネルを共有している。
v2 を将来登録するとき、alert ファイルを分けるべきか(今は分けない方針でよいか)。

**M. `/api/data` のセキュリティ(D17)**
spec08 に「本人判断」として記録済みの件。今回の範囲で、
(b) 合言葉比較を `crypto.timingSafeEqual` にする / (c) CORS を自ドメインに絞る
の2つだけでも実施してよいか。それとも一切触らないか。
