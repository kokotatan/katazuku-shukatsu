# Spec 06: 面接ログ

最終更新: 2026-07-18

## 目的

会議録音から、文字起こし、構造化議事録、人物、自己分析候補、次アクションまでを自動反映する。

## 実装

1. `meeting-autopilot.ps1` がDBのappointmentを見て、会議URLのある予定（面接・面談・説明会等）を選び、開始5分前に `record-vac.ps1` を予定ID付きで起動する。インターン参加、宿泊、対面、終日・24時間以上の予定は対象外。[録音対象の規則](../RECORDING-POLICY.md)を参照。
2. ffmpegでシステム音声とマイクを16kHz stereo wavの別チャンネルへ録音する。
3. `interview-digest.ps1` が30秒チャンクに分割し、Voicebox Whisperで全チャンクを文字起こしする。
4. `interview-digest-prompt.md` が全文ノートと厳格JSONを生成する。
5. `db-apply-interview.ts` が1トランザクションで次へ反映する。
   - interview_note
   - person / appointment_person
   - person_note（追記専用、sourceRefとconfidence付き）
   - profile_suggestion（自己PR系のみ。確定個人情報は上書きしない）
   - event
   - appointmentとmeeting_runの完了
6. `db-snapshot.ts` でアプリへ反映する。

`runId` は一意で、再実行しても二重登録しない。録音・文字起こし・JSON・ノートはgitignore領域にだけ置く。

## 状態機械

`meeting_run`: armed → opened → recording → stopping → digesting → done。
予定IDごとに一行だけ作り、ファイル状態は正本にしない。

## 受け入れ条件

- 同じrunIdの再適用で面接・人物メモ・候補が増えない
- 人物メモに根拠と確度が残る
- 確定プロフィールを自動上書きしない
- 議事録反映後にappointmentとmeeting_runがdoneになる
