# Spec 10: 面接から人物・基本情報を自動更新する

最終更新: 2026-07-18
状態: 実装済み

## 方針

面接を重ねるほど人物と自己分析が育つ。ただし、氏名、住所、生年月日などの確定情報は面接から上書きしない。

## 実装済みフロー

`interview-digest` が厳格JSONへ次を出力し、`db-apply-interview.ts` が一括反映する。

- 面接官: personへ氏名、会社、役割、出会いを補完
- 人物メモ: person_noteへsourceRefとconfidence付きで追記
- 面接との紐付け: appointment_person
- 自己分析: profile_suggestionへ候補追加
  - 対象: strengths / weaknesses / careerAxis / desiredRole / desiredIndustry
- 面接記録: interview_note
- 冪等性: runIdをinterview_note.source_refの一意キーにする

profile_basicは確定情報、profile_suggestionは候補という2層に分離した。候補の採用は本人判断または会話での明示指示による。

## 初期移行

`db-import-private.ts` が既存people/profileシードをDBへ移す。写真は分離保存し、profile JSONとsnapshotからdata URLを除去する。

## 検証

`check-db.ts` で、人物重複防止、写真分離、根拠付き人物メモ、プロフィール候補、必要テーブルを検査する。
