# Spec 07: 人物

最終更新: 2026-07-18

## 目的

面接官、社員、OBOGを、所属、役割、出会い、会話、フォロー、顔と結び、次回面接前に思い出せるようにする。

## データ

- `person`: 氏名、会社、役割、分類、出会った日・文脈、フォロー
- `person_note`: 追記専用。note、source_ref、confidence
- `appointment_person`: 予定と人物の多対多
- `person_photo`: storage_key、sha256、verified_at。画像本体は持たない
- `interview_note`: 面接要約と構造化詳細

氏名×会社で名寄せする。面接のたびに既存人物を補完し、メモは上書きせず追加する。

## 画面

`people/` は共通DBクライアントから人物と人物メモを読み、顔、所属、役割、出会い、フォロー、直近メモを表示する。
人がブラウザから正本を編集する機能は持たない。修正は会話でagentへ依頼する。

## 写真のセキュリティ

- ローカル: `data/private/photos`（gitignore）
- クラウド: Vercel Private Blob
- DBとsnapshot: storage keyと検証情報だけ
- 読取: 合言葉認証付き `/api/photo`
- 投入: bearer認証付き `/api/photo-push`
- 公開URL、public/、git、data URL形式のsnapshot掲載は禁止

既存シード11名、顔3枚は2026-07-18にDBへ移行済み。

## 受け入れ条件

- snapshotに `data:image` が含まれない
- 人物写真は認証API以外から取得できない
- 同じ氏名×会社を再投入しても重複しない
- 面接から人物・メモ・予定紐付けが1トランザクションで入る
