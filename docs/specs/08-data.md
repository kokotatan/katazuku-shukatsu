# Spec 08: Katazuku Data(DB中心のデータ基盤)  ※2026-07-18 全面改訂

> 【改訂の背景 2026-07-18】旧08は「localStorageのキーを企業軸で読み取り結合し status で見る」閲覧レイヤーの
> 設計だった。だが本人の実画面は **katazukuアプリ + Googleカレンダー** であり、データが Sheet / localStorage /
> カレンダー / ローカルファイルに分散し、agentが手で同期している構造そのものが、日程バッティングやステータス齟齬
> (例: 八洲=シート「合格」なのに実態は辞退済)の温床だった。本specは土台を **DB中心** に置き換える。

## 目的 / 直す問題

**「正(source of truth)」をDB1つに定め、アプリ・カレンダー・Sheetをその"見る窓"にする。agentを唯一の書き手にする。**

特に直すのは、選考ステータスの更新が効かない問題。旧 `status/src/lib/sheet.ts` は、自由記述ステータスのタブに対して
**「合格/不合格/辞退などの最終状態は絶対に上書きしない・空欄補完のみ」** という制約を持っていた(L9-13, L144-151)。
これは「Sheetが人の手入力とagent同期の両方に晒され、どちらが新しいか判別できない」ための苦肉の策で、結果として
**メール由来の状態変化(辞退・合否)がシートに反映されない**弱さになっていた。DB中心化で「書き手はagent1つ・正はDB」に
なれば、この矛盾は消え、**正しい遷移規則で堂々と更新できる**(下記「書き込みモデル」)。

## アーキテクチャ

```
        ┌── katazuku アプリ(inbox/status/insight)  … 見る+書く窓(認証API経由でDBを読み書き)
DB(正) ─┼── Google Calendar(色つき)               … 見る窓(agentがDBから同期)
        └── Google Sheet(選考管理)                 … 見るだけの窓(DB→Sheet 一方向ミラー)
   ↑
   agent(唯一の書き手): メール→DB / ユーザーのアプリ操作→DB / DB→カレンダー・Sheet
```

- **DB**: Vercel Marketplace の Postgres(Neon 想定)。フルの独自基盤は作らない。
- **認証つき読み取りAPI**: `api/` に「ログイン本人にだけDBの中身をJSONで返す」エンドポイントを1本。
  個人データを漏らさずにアプリが自動ロードする(手作業のlocalStorage JSON注入を廃止)ための最小の裏側。
- **Sheetは読み取り専用ミラー**。編集はアプリ/agent(=DBに書く)に一本化。Sheet直編集は двой book=ドリフト源なので不可。
  スマホでの俯瞰用に DB→Sheet を定期同期する。

## データモデル(最小)

- `company`(企業): id, name(名寄せキーは既存 `sameCompany`), industry, position, priority, notes
- `selection`(選考): id, company_id, season(夏/冬/本選考/長期), status, next_action, next_date, source_note, updated_at, updated_by
- `interview_note`(面接ノート): 旧08のInterviewNote(company, date, kind, asked/highlights/firstPartyInfo/concerns/nextActions/source)
- `person`(人脈, spec07), `es_snippet`(ES素材/個人マスタ) … 段階的に寄せる

## 書き込みモデル(「上書きしない」を正しく置き換える)

- **status は遷移規則で更新する**(空欄補完のみ、はやめる)。ランク(出願予定<出願済<合格/不合格/辞退)で
  **前進は反映**。最終状態(合格/不合格/辞退)への確定はメール根拠があれば反映してよい。八洲のような「辞退済なのに合格のまま」を解消。
- **人の意図とagent更新の衝突**は "最終更新者(updated_by)と時刻" で解決(Sheet直編集を禁じたので実質agentのみ)。
- 名寄せは `sameCompany`(NFKC・短名完全一致)を踏襲。重複行(GMOビジネス職/技術職のような別トラック)は別レコードで持つ。

## 実装フェーズ(段階投入・各フェーズで完結)

1. **DB + 認証読取API + agent書込 + Sheetミラー**。まずは選考/企業だけ。既存Sheetからの初期移行スクリプト。
2. **アプリをDB読取に切替**(inbox/status/insight)。localStorage手注入を廃止。カレンダー同期は reconcile-calendar をDB源に繋ぎ替え。
3. **面接ノート・人脈・ES素材(個人マスタ)をDBへ**。insight(spec09)はDB上の横断クエリで実装。

## セキュリティ

- 個人データはDBに置き、**認証済み本人にのみ**APIで返す。public/ には出さない(静的アプリは認証API越しに読む)。
- SA鍵・DB接続情報は gitignore 済みの場所(.env / credentials/)へ。設定ファイルへの平文直書き禁止。

## やらないこと

- フルスクラッチの独自バックエンド/認証基盤は作らない(Vercel Marketplace + 最小 `api/` で足りる)。
- Sheetの双方向同期はしない(DB→Sheetの一方向のみ)。ドリフトを戻さないため。
- 旧08の「localStorageキー結合」路線は破棄(DB読取に置換)。

## 関連

- 方針メモ: DB=正・各面は窓・agentが唯一の書き手(本人合意2026-07-18)。旧 `status/src/lib/sheet.ts` の
  「上書きしない」制約は本specで解消。reconcile-calendar は Phase2 で源を Sheet→DB に繋ぎ替える。
