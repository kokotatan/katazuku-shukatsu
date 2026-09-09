# MiniPC障害時の緊急フェイルオーバー

## 目的

MiniPC (`KOKOTATANPC`) が電源断・回線断・故障で使えない間だけ、ノートPCを期限付きの暫定正本にする。
単に `.katazuku-satellite` を消す方法は禁止する。MiniPC復帰時に二重正本となり、同じメールや予定を別々のDBへ
書き込む事故を防げないためである。

## 現在の安全境界

- `.katazuku-satellite` は残したまま、gitignoreされた `.katazuku-emergency-canonical.local.json` を正本リースとして使う。
- リースは20分で失効する。`katazuku-failover-guard` が5分ごとにMiniPCのTailscale状態を確認し、
  MiniPCがオフラインの間だけ20分先へ更新する。
- ガード停止、状態不明、JSON破損、別端末、期限切れではDB書き込みを拒否する。
- MiniPC復帰を検知したら、ノートPCのcalendar-sync / daily-sync / mail-watch / asa / evening-brief / watchdogを停止し、
  リースをpausedにする。meeting-autopilotは通常の衛星機モードへ戻り、DB反映をMiniPCへ送る。
- 最終期限はactivate時に最大14日以内で固定する。延長は状態を再確認してactivateし直す。

## 操作

```powershell
# 状態確認
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/emergency-failover.ps1 -Operation status

# MiniPCがTailscale上でofflineと確認できた場合だけ有効化
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/emergency-failover.ps1 `
  -Operation activate -HardExpiresAt '2026-09-09T00:00:00+09:00' -EnableScheduledTasks

# ガードの修復・再登録
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/emergency-failover.ps1 -Operation install-guard

# 手動停止
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/emergency-failover.ps1 -Operation pause

# MiniPCとの照合と統合が終わった後だけ解除
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/emergency-failover.ps1 -Operation deactivate
```

`activate` は次を行う。

1. TailscaleでMiniPCがofflineであることを確認する。
2. `logs/db-backup-from-minipc` または `data/katazuku.db.retired-laptop-*` の最新DBへ
   `PRAGMA integrity_check` とdatabase identity確認を行う。
3. `logs/failover/<failover-id>` に復旧元DBを退避する。
4. ノートPCの `data/katazuku.db` を期限付き正本として配置する。
5. ガードと暫定定常タスクを有効にする。

## 退役DBが古い場合の埋め戻し

Calendarは保存済みOAuthを使う決定的同期で再取得する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/calendar-sync.ps1
```

Google Workspace MCPが壊れていても、Gmail RESTの読み取り専用取得から日別JSONを作れる。

```powershell
cd sync
npx tsx scripts/gmail-fetch.ts gmail-backfill-20260829.json --after 2026-08-29 --before 2026-08-30
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/daily-sync-v2.ps1 `
  -MailInputPath sync/gmail-backfill-20260829.json -Agent codex
```

`gmail-fetch.ts` はラベル変更、既読化、下書き、送信を行わない。後段は既存のJSON Schema、遷移規則、
名寄せ保留、トランザクション、冪等化を通る。

## MiniPCが戻ったとき

1. ガードがリースをpausedにし、暫定タスクを停止したことを確認する。
2. MiniPC側の定常タスクも一度停止し、双方のDBをバックアップする。
3. MiniPC停止直前のDBとノートPC暫定DBを比較する。ノートPCDBでMiniPCDBを即時上書きしない。
4. Gmail・Calendar・提出結果は同じ期間をMiniPCへ再適用する。ref/external_idによる冪等化を使う。
5. 会話・面接録音・ローカル添付など再取得できない入力だけ、failoverログを根拠に個別反映する。
6. 全テスト、snapshot、アプリ表示を確認してから `deactivate` する。

## 再発防止

帰仙後、次を実機で設定・確認する。

- BIOS/UEFIの `Restore on AC Power Loss` を `Power On` にする。
- MiniPCだけでなくルーターもUPSへ接続する。スマートプラグは状態確認と電源再投入に使うが、
  BIOS自動起動が無ければ電源復旧にならない。
- MiniPC外への暗号化DBバックアップを毎日実行し、少なくともノートPCへ4週保持する。
- Tailscale offline、failover guard停止、snapshot配信失敗を外部監視し、本人のスマホへ通知する。
- 正本切替は常に期限付きリースとfencingを使い、手動で衛星機マーカーを消さない。
- Wake-on-LANはスリープ復帰には使えるが、電源断やルーター断の代替にはしない。

## 2026-08-29の付随障害

Vercel Functionsのログで `BlobStoreSuspendedError` を確認した。ローカルDB生成と日次バックアップは成功するが、
Vercel Blobへのsnapshot pushとWebアプリの最新データ取得は復旧しない。Blob利用再開か、準備済みCloudflare R2への
切替は、課金・外部リソースの判断後に行う。
