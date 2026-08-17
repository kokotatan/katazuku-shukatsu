# OSS移植マニフェスト（katazuku-shukatsu 公開版）

最終更新: 2026-08-14

本番リポジトリ `katazuku-shukatsu-private` の追跡ファイルを、公開OSSリポジトリ
`katazuku-shukatsu`(Private→将来Public)へ移植する際の分類台帳。
方針の親文書は [oss-roadmap.md](./oss-roadmap.md)。

## 分類の基準

| 判定 | 意味 | 対処 |
|---|---|---|
| **公開** | 個人データを含まない汎用コード・設定・テスト | そのまま移植 |
| **要匿名化** | 汎用コードだが、実名・実メール・シートID等が値として焼き込まれている | 値を設定/env/匿名seedへ外出しして移植 |
| **出さない** | 本質的に個人・インフラ固有(個人プロンプト、進捗、既存リソース台帳、認証運用) | 移植しない。必要なら汎用版を書き下ろす |

大前提: **履歴はコピーしない**。公開リポジトリは新規 history。本番の git 履歴には
過去の個人データが残っているため、ファイル単位で新規コミットする。

## サマリ（追跡349ファイル)

個人データ混入は **35ファイル**。残り314は一次判定「公開候補」だが、第一弾スコープは核に絞る。

| ディレクトリ | 数 | 主判定 | 第一弾に載せるか |
|---|---:|---|---|
| `sync/` | 49 | 公開(核)。`src/sheet.ts` のみ要匿名化 | **載せる**(DB+セマンティックレイヤーの中心) |
| `schemas/` | 2 | 公開(核) | **載せる**(Schema駆動の土台) |
| `scripts/` | 75 | 混在。runnerは要匿名化、prompt(.md)は出さない | 一部のみ(汎用runnerの匿名化版) |
| `board/` | 9 | 公開(閲覧SPA参照実装) | 載せる候補(read-only) |
| `landing/` `status/` `inbox/` `profile/` `people/` `prep/` `impact/` `insight/` | 152 | 混在。UIは公開可、既定値・シートID参照は要匿名化 | 第二弾以降(段階公開) |
| `docs/` | 28 | 大半が出さない(INFRA台帳・進捗・個人specs) | 出さない(公開用docsは書き下ろし) |
| `chrome-prompts/` | 11 | 出さない(個人データの正) | 出さない |
| `api/` | 7 | 出さない(タグ apps-archive で廃止済み) | 出さない |
| `tools/` | 3 | 要匿名化(VAPID subjectにメール) | 第二弾 |
| ルート/`db/`/`tasks/`/`shared/` | 12 | 混在 | 個別判断 |

## 第一弾コア（公開・最小で価値が伝わる集合)

就活の固有ドメインを含まず、設計の価値が中心に出る集合。

- `sync/src/db.ts` — 状態機械 `transition()`、エンティティ解決 `resolveCompany/addAlias`、冪等判定
  `sameCompany/samePosition/sameAppointment`、正規化。**無汚染確認済み**
- `sync/src/application.ts` — 応募イベントの状態管理。**無汚染確認済み**
- `sync/scripts/check-*.ts` — 依存ゼロの自前assertテスト群(公開版の回帰テストにそのまま使える)
- `schemas/application-start.schema.json` / `application-event.schema.json` — Schema駆動の実例
- **設定GUI(新規)** — `settings.schema.json` + Schema駆動の設定フォーム(2026-08-14 作成のPoCを正式化)
- 匿名 seed DB(ダミー企業・ダミー選考のみ。新規作成)

## 要匿名化リスト（35件のうち、汎用コードで値だけ外出しすればよいもの)

| ファイル | 焼き込まれている値 | 対処 |
|---|---|---|
| `sync/src/sheet.ts` | 個人シートID定数 | `SHEET_ID` を env/config へ |
| `status/src/lib/sheet.ts` | 個人シートID定数 | 同上 |
| `sync/scripts/db-mirror.ts` | 個人シートID定数 | 同上 |
| `sync/scripts/calendar-fetch.ts` | 既定メールアドレス | `KATAZUKU_CAL_ACCOUNT` 既定を空/例示に |
| `tools/gen-vapid.mjs` | VAPID subject の実メール | 引数/env 化 |
| `inbox/scripts/check-reply-api.ts` | 署名テンプレの実名・実メール・大学名 | 匿名fixtureに置換 |
| `inbox/vite.claude-reply.ts` | 署名テンプレの実名・実メール | 設定(署名テンプレ)を外出し |
| `profile/src/components/BasicProfileForm.tsx` | フォーム既定値(姓名) | 既定値を空/プレースホルダに |
| `profile/src/types.ts` | 個人属性の例示 | 匿名例に |
| `landing/robots.txt` | コメントに実名 | 汎用コメントに |
| `scripts/calendar-sync.ps1` / `asa-auto.ps1` / `katazuku.ps1` / `open-meeting-urls.ps1` | 実行値・アカウント | 設定ファイル参照へ(移植は第二弾) |
| `scripts/local-login/README-daily-login.md` / `register-credentials.bat` | アカウント名 | 例示アカウントに |

## 出さないリスト（本質的に個人・インフラ固有)

- `AGENTS.md` / `CLAUDE.md` — 個人プロジェクト運用指示。公開用は別途書き下ろす
- `docs/INFRA.md` — 既存クラウドリソース台帳(プロジェクトID・秘密の所在)。**絶対に出さない**
- `docs/PROGRESS.md` / `docs/GOOGLE-MCP-SETUP.md` / `docs/MINIPC-SETUP.md` / `docs/specs/01,12,15` — 個人進捗・個人環境
- `chrome-prompts/*`(11) — 個人データの正(`_profile.md` ほか)
- `scripts/*-prompt.md`(asa/daily-sync/evening-brief/interview-digest/mail-watch/reconcile-calendar) — 個人文脈入りプロンプト。公開版はテンプレ化して書き下ろす
- `scripts/minipc-bootstrap.ps1` — 個人機のプロビジョニング
- `api/*`(7) — 廃止済み(タグ `apps-archive-20260718`)

## 移植手順（第一弾)

1. 公開リポジトリに `packages/core`(=sync/src)、`packages/schema`(=schemas + settings.schema.json)、
   `examples/`(匿名seed)、`docs/`(公開用README・SECURITY)の骨組みを作る
2. 上記コアを**新規コミット**で移植(履歴はコピーしない)
3. 要匿名化リストのうち第一弾に必要なものだけ、値を外出しして移植
4. secret/個人情報スキャナをCIに入れ、混入を継続的に検出
5. 匿名seedだけで `check-*.ts` 全通過を確認してから、次弾(UI・runner)へ

## 公開前チェック（この manifest 由来)

- [ ] 第一弾の全ファイルを個人データ再走査(氏名/メール/シートID/大学/電話/住所)して0件
- [ ] 匿名seedだけでテストが通る
- [ ] 履歴に個人データが無い(新規history)
- [ ] LICENSE(Apache-2.0)・SECURITY・CONTRIBUTING を同梱
