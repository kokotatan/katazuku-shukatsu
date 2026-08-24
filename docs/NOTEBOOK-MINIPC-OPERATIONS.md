# ノートPCとMiniPCの運用境界

## 結論

- ノートPCのCodexは、ノートPC上でローカル実行する。
- Chrome、Downloads、OAuth、CAPTCHA、本人確認、録音はノートPCだけで扱う。
- `KOKOTATANPC` はMiniPCであり、正本DBと定常タスクを持つ。
- ノートPCから正本側の処理が必要な場合だけ、SSHでMiniPCの許可済み入口を呼ぶ。
- Chrome拡張を経由した別端末のリモートファイル添付は使わない。

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
