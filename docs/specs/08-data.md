# Spec 08: DB中心データ基盤

最終更新: 2026-07-18

## 原則

- 正本は `data/katazuku.db` 1つ
- 書き手はagentだけ
- アプリ、Google Sheets、Google Calendarは入力または閲覧窓であり、正本ではない
- 状態変化はeventへ根拠付きで残し、selection.status/outcomeは結果のキャッシュとして扱う
- DBを書いたら必ず `cd sync && npx tsx scripts/db-snapshot.ts`

## 配線

```
Gmail ───────────────┐
本人との会話 ────────┤
面接録音 ────────────┤
提出結果 ────────────┼─→ data/katazuku.db
Google Calendar ─────┤       ├─→ snapshot → Private Blob → 8アプリ
企業研究 ────────────┘       └─→ Google Sheets（一方向ミラー）
```

6入力すべてに専用CLIがある。

| 入力 | 入口 |
|---|---|
| メール | `db-apply.ts` + `db-apply-mail.ts` |
| 会話 | agentがdb.tsの規則で書く |
| 面接 | `db-apply-interview.ts` |
| 提出結果 | `db-apply-submission.ts` |
| カレンダー | `db-apply-calendar.ts` |
| 企業研究 | `db-apply-research.ts` |

## スキーマ

- 企業・選考: company / company_alias / selection / pending_review
- 出来事・予定: event / appointment
  - appointmentはexternal_id、calendar_id、source_hash、end_atを持つ
- 会議: meeting_run
- 面接・人物: interview_note / person / person_note / appointment_person / person_photo
- 個人情報: profile_basic / profile_suggestion
- 提出・研究・メール: submission / company_dossier / mail_item
- 応募自動運転: application_run / application_event / application_material / web_assessment

appointmentはカレンダー入力だけでなく、external_idが空の予定をoutboxとして外部カレンダーへ出力する。
作成成功後にexternal_idをDBへ戻し、二重作成を防ぐ。

## 遷移規則

selection.statusの更新は `transition()` に集約する。

- 終了系は根拠があれば確定する
- 終了済みから復活させない
- 詳しい進行状態を粗い「出願済」「選考中」で潰さない
- 「辞退予定」は本人意思として内定通知でも上書きしない
- status自由文とoutcome列挙を分ける

## 名寄せ

- company: NFKC、法人格・英語法人表記を吸収。部分一致は両方4文字以上
- position: 完全一致または両方4文字以上の包含一致
- 既存1トラックのpositionが空なら、後から分かった具体名へ昇格する
- 怪しい会社名はpending_reviewへ置き、自動マージしない
- 既存重複は `db-merge-tracks.ts` で関連レコードごと統合する

## スナップショットと機密

snapshotには表示に必要なデータだけを含める。

- company.passwordは除外
- data URL画像は再帰的に除外
- 写真本体はPrivate Blob、snapshotはstorageKeyだけ
- APIはread/write別の秘密で認証
- `data/`、`logs/`、`.env`、`*.local.md` はgitignore

## アプリ

共通パッケージ `@katazuku/data` が `/api/data` を読む。
inbox/status/profile/people/prep/impactは2026-07-18にlocalStorage正本を廃止した。
insight/boardも同じsnapshotを読む。ブラウザに保存するのは閲覧用合言葉だけ。

## 検証

- `check-db.ts`: 遷移、名寄せ、apply、mirror、新スキーマ、写真分離
- `check-sheet.ts`: 旧シートエンジン。移行完了まで残す
- 6入力はテストDBでcalendar→mail→submission→research→meeting_run→interviewを統合検証する
