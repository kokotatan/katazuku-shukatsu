# Claudeへの残作業依頼（2026-07-19）

この文書を最初から最後まで読み、リポジトリ直下の AGENTS.md、CLAUDE.md、docs/PROGRESS.md、docs/INFRA.md も読んでから作業してください。
返答・ログ・コミットは日本語、絵文字は禁止です。既に完了した実装を作り直さず、外部環境に依存して残った作業を完了してください。

## 現在の完成状態

Codexが次を実装・検証済みです。

- DB入力6本: メール、会話、面接録音、提出結果、Google Calendar、企業研究
- inbox/status/profile/people/prep/impactを共通 @katazuku/data による認証snapshot読取へ移行
- 人物11名、顔3枚、個人基本情報をDBへ移行
- 写真本体をDB・snapshot・gitから分離し、Private Blob用APIを追加
- meeting_run状態機械と、面接厳格JSON反映を実装
- 重複選考トラック5組を統合し、selectionを92件から87件へ整理
- 応募自動運転の安全境界、承認、Web適性検査、カレンダーoutboxの実装も作業ツリーにあり、専用テスト18件が通過

検証済み:

- cd sync && npx tsx scripts/check-db.ts
- cd sync && npx tsx scripts/check-sheet.ts
- cd sync && npx tsx scripts/check-application.ts
- npm run check
- 8アプリは tsc --noEmit と vite build --configLoader runner で全件成功
- APIと新規syncスクリプトのTypeScript型検査成功
- PowerShell 10本の構文検査成功
- snapshotにpasswordとdata:imageが含まれないことを確認

通常の npm run build はCodexサンドボックスがesbuildの親ディレクトリ走査を拒否したため失敗しただけで、8アプリ個別ビルドとdist組立は成功しています。

## 残作業1: Windows定常タスクの実登録

Codex環境ではWindows Task Scheduler APIがアクセス拒否になりました。通常ユーザーのPowerShellから次を実行してください。

powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-all-tasks.ps1

登録後、次の5本が存在すること、WakeToRun、StartWhenAvailable、IgnoreNewが設定されていることを確認してください。

- katazuku-mail-watch
- katazuku-daily-sync
- katazuku-asa
- katazuku-calendar-sync
- katazuku-meeting-autopilot

旧 katazuku-meeting-opener は二重起動を防ぐため無効であることを確認してください。登録結果をdocs/INFRA.mdへ記録してください。

## 残作業2: Claudeトークン復旧後の実走

2026-07-19の実走ではClaudeトークン切れにより、daily-syncとcalendar-syncが ConnectionRefused で終了しました。
トークン復旧後、次を手動実行してください。

- powershell -NoProfile -ExecutionPolicy Bypass -File scripts/daily-sync.ps1
- powershell -NoProfile -ExecutionPolicy Bypass -File scripts/calendar-sync.ps1

確認項目:

- logs/sync-*.log に === daily-sync DONE ===
- logs/calendar-sync-*.log に === calendar-sync DONE ===
- alert-daily-sync.txt / alert-calendar-sync.txt が正常復帰後に消える
- mail_item、submission、appointmentへ事実どおり反映される
- DBに書いた直後に db-snapshot.ts が実行される
- シートミラーと活動ログが更新される
- メール本文や選考事実を創作しない

## 残作業3: Vercel反映と実機確認

Codex環境からsnapshot pushは fetch failed でした。次を完了してください。

1. 現在のブランチをVercelへデプロイ
2. KATAZUKU_READ_SECRET、KATAZUKU_WRITE_SECRET、Blob設定を確認
3. cd sync && npx tsx scripts/db-snapshot.ts
4. cd sync && npx tsx scripts/photo-sync.ts
5. /api/dataが合言葉付きで最新snapshotを返すことを確認
6. /api/photoが合言葉付きで顔写真を返し、未認証では拒否することを確認
7. katazuku.kotalabo.comをスマホで開き、8アプリの表示と主要導線を確認

秘密値、写真本体、data/、logs/、.env、*.local.mdはコミットしないでください。

## 残作業4: 応募自動運転の実装監査

次の並行変更は専用テスト18件が通っています。内容を監査し、未完成なら最小限だけ修正してください。

- sync/src/application.ts
- sync/scripts/db-application.ts
- sync/scripts/db-calendar-outbox.ts
- sync/scripts/db-link-calendar.ts
- sync/scripts/check-application.ts
- scripts/application-autopilot.ps1
- scripts/calendar-export-prompt.md
- chrome-prompts/09-application-autopilot.md
- docs/specs/11-application-autopilot.md
- docs/oss-roadmap.md

禁止事項:

- 本人承認なしにエントリーやESを最終送信しない
- Web適性検査、コーディングテストを代行受験しない
- ES本文、検査問題、解答をDBへ保存しない
- 認証やCAPTCHAを回避しない
- 実企業への送信テストは本人のその場の明示承認なしに行わない

## 残作業5: コミット

Codexセッションでは .git が読み取り専用で、.git/index.lock を作れずコミットできませんでした。
現在の差分を確認し、機密がないことを再検査して、次の2コミットへ分けてください。

1. DB入力6本とアプリ読取基盤を完成
   - DB/platform/input CLI、6アプリ、写真API、会議・面接、重複統合、仕様書
2. 応募自動運転の安全な実行基盤を追加
   - application.ts、application系CLI・テスト・プロンプト・spec11・OSS論点

コミット前に必ず実行:

- git diff --check
- npm run check
- 8アプリのTypeScript検査
- git status --shortでdata/logs/.env/*.local.md/service-account.jsonが入っていないことを確認

## 完了報告

次を日本語で報告してください。

- 2つのコミットID
- Windowsタスク5本の登録状態
- daily-sync / calendar-syncの実走結果
- Vercel deployment URL
- snapshot・写真API・スマホ表示の確認結果
- 残る外部ブロッカー
