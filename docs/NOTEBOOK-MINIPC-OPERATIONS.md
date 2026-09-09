# ノートPCとMiniPCの運用境界

## 結論

- ノートPCのCodexは、ノートPC上でローカル実行する。
- Chrome、Downloads、OAuth、CAPTCHA、本人確認、録音はノートPCだけで扱う。
- `KOKOTATANPC` はMiniPCであり、正本DBと定常タスクを持つ。
- ノートPCから正本側の処理が必要な場合だけ、SSHでMiniPCの許可済み入口を呼ぶ。
- Chrome拡張を経由した別端末のリモートファイル添付は使わない。
- MiniPC障害時の期限付き暫定正本は `docs/EMERGENCY-FAILOVER.md` に従う。衛星機マーカーを手で消さない。

## 初回セットアップ（ノートPCで実行）

同じリポジトリをノートPCへcloneした後、次を実行する。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-notebook-satellite.ps1
```

この処理は `.katazuku-satellite` を作り、端末をreplicaとして固定する。正本DBとしての書き込みを防ぐ既存の判定が有効になる。
SSHのホスト鍵や公開鍵が未設定なら、先に本人が次を一度実行する。

```powershell
ssh KOKOTATANPC
```

パスワードや秘密鍵の内容はリポジトリ・チャット・ログへ保存しない。

## ノートPCの録音状態表示

`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/register-recording-status.ps1` で、
画面右下の常駐表示とログイン時の自動起動を設定する。ドラッグで位置を変えられ、次回も復元する。
**Ctrl + Alt + Shift + R** で、他のアプリを使っていても表示・非表示を切り替えられる。
「−」は表示を隠すだけ。通知領域のアイコンをダブルクリック、または右クリックの「表示 / 非表示」でも切り替える。
録音開始時は自動表示する。その録音中に本人が隠した場合は、通常の状態更新や見張りの録り直しでは表示を戻さず、
次の録音を検出したときに再表示する。

Ctrl + Alt + Rは実機で競合したため、Shift付きで固定した。使用中のキーは通知領域のメニューにも表示する。
登録状況は診断JSONの `hotKeyRegistered` / `hotKey` に保存する。
運用からは `start-recording-status.ps1 -Action Show|Hide|Toggle` で指定でき、省略時はShow。

小窓と右クリックメニューはWindowsの `WDA_EXCLUDEFROMCAPTURE` で画面共有・録画から除外し、
タスクバーには表示しない。本人のモニター上の表示は維持する。除外設定ができない環境では小窓を隠し、
通知領域だけに留める。除外状態は `logs/recording-display.local.json` の `captureExcluded` で確認する。
これはWindowsのキャプチャAPIによる除外であり、共有ソフト独自の取り込み方法すべてを保証するものではない。

- 「録音中」: katazukuのffmpeg録音プロセスが存在し、音声ファイルの増加を確認済み。経過時間を表示。
- 「録音停止中」: 対象の録音プロセスが存在しない。
- 「録音開始を確認中」: 音声ファイルへの書き込みをまだ確認していない。
- 「録音を確認」: プロセスは存在するが、15秒以上ファイルが増えていない。
- 「録音状態を確認できません」: プロセスを照会できない、または監視結果が10秒以上更新されていない。

対象は `record-vac.ps1` / `record-audio.ps1` の録音と、見張りによる録り直し。Game Bar等の別アプリの
録画状態や発話の内容・音質は判定しない。表示を終了しても録音は続く。
診断は `recording-status.ps1 -Once`、判定の回帰確認は `check-recording-status.ps1`、切替と自動表示の回帰確認は
`check-recording-display.ps1`、表示部品の描画確認は
`render-recording-status.ps1`。状態と位置だけを `logs/recording-display.local.json` に保存し、
会議名・音声・録音ファイル名をDBやsnapshotへ追加しない。

## 許可済みのリモート操作

```powershell
# MiniPCと正本DBの存在確認
powershell -File scripts/notebook-minipc.ps1 -Operation health

# DB変更後のアプリ反映
powershell -File scripts/notebook-minipc.ps1 -Operation snapshot

# 正本DBの回帰確認
powershell -File scripts/notebook-minipc.ps1 -Operation check-db

# 自律処理の確認
powershell -File scripts/notebook-minipc.ps1 -Operation activity-report
```

第三者宛メールはGmailの直接コネクタから送らず、action JSONをMiniPCへ渡して次の順で処理する。

```powershell
# 正本DB・Calendar・文面・重複を検査し、本人へ提示するaction hashを固定
powershell -File scripts/invoke-minipc-db.ps1 -Operation email-prepare -RunId mail:<一意ID> -InputPath <action.json>

# 本人が表示された宛先・本文・日時を確認した後だけ実行
powershell -File scripts/invoke-minipc-db.ps1 -Operation email-approve -RunId mail:<一意ID> -InputPath <同じaction.json>
powershell -File scripts/invoke-minipc-db.ps1 -Operation email-send -RunId mail:<一意ID> -InputPath <同じaction.json>
```

`prepare`、`approve`、`send`の間でaction JSONが1文字でも変わると拒否する。`send`はCalendar同期と
正本DB照合をもう一度行い、送信済み・成否不明では再送しない。本人が承認しない場合は
`email-reject`を使う。添付ファイルはactionを提示する前にMiniPC上へ安全に転送し、actionには
MiniPCから実在確認できるパスを記載する。

任意の文字列をSSH先のshellへ渡す汎用入口は設けない。新しい正本操作が必要になったら、MiniPC側の決定的CLIを確認したうえで`ValidateSet`へ個別追加する。

## GitとDB

- コードは両端末でGit同期する。
- ノートPCでは作業ブランチを使い、MiniPCの同じworktreeをSSH越しに編集しない。
- `data/katazuku.db`、`logs/`、`.env`、OAuth資格情報はGit同期しない。
- DB書き込みはMiniPCだけで実行し、その直後にsnapshotを実行する。

## Google Workspace MCP

- 現行の`workspace-mcp-bridge.mjs`は、親のstdin終了・シグナル・例外時に子プロセスツリーを回収する。
- 旧構成で直接起動された24時間超のMCPは、watchdogが`cleanup-workspace-mcp.ps1`で回収する。
- 現行のnode bridge配下と24時間以内のMCPは掃除対象にしない。
