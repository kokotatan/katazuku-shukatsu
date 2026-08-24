# Spec 15: 常時稼働MiniPCへの移行

最終更新: 2026-07-24

## 2026-08-24 運用決定: 同じkatazukuの2実行拠点

「ブラウザ操作もMiniPCへ寄せる」案は採用しない。Chrome拡張の接続、ローカルファイル権限、
端末判定をまたいでノートPCのファイルを添付する経路が不安定だったため、役割を次で固定する。

| 実行拠点 | 担当 |
| --- | --- |
| ノートPC | Gmail・応募サイトのブラウザ操作、Downloads添付、OAuth/CAPTCHA/本人確認、会議・録音 |
| MiniPC | 正本DB、Gmail/Calendar同期、定常タスク、snapshot・バックアップ、重い調査・バックグラウンド処理 |

ノートPCからDB更新が必要な場合は、`.katazuku-satellite` によるローカルDBガードの下で
`scripts/invoke-minipc-db.ps1` を使う。このCLIは操作を許可リストへ限定し、JSONをASCII名でMiniPCへ転送、
MiniPC上の `db-apply-*` と `db-snapshot.ts` を連続実行する。コード変更はそれぞれのcloneでGit同期し、
SSH越しに同じ作業ディレクトリを編集しない。

```text
ノートPCのCodex
  +-- ローカルChrome・Downloads・会議/録音
  +-- SSH許可リストCLI
        +-- MiniPCの正本DB
        +-- snapshot・活動ログ
```

提出結果の例:

```powershell
.\scripts\invoke-minipc-db.ps1 -Operation apply-submission -InputPath .\tmp\submission.json
```

ノートPCに残す `katazuku-meeting-autopilot` も、agenda取得とmeeting_run更新は同じSSH入口を使う。
Google Workspace MCPの多重残留はMiniPC側の同期基盤の問題として扱い、ノートPCのChrome操作とは切り離す。

## 目的

見張り(mail-watch)、毎日同期(daily-sync)、朝のまとめ(asa)、カレンダー同期、毎日ログイン、
DBミラーといった定常処理を、本人の主PCの電源・バッテリー・在席に依存せず24時間回す。

同時に、ヘッドレス化できない作業(ブラウザ操作、面接録音、資格情報の登録、対話認証)を
どこへ残すかを明示し、正本DB `data/katazuku.db` の「書き手はagentだけ」「正本は1つ」という
不変条件を壊さずに移行する。

本仕様は計画である。実行(インストール、タスク登録、DB移設)は本人の承認後に別途行う。

## 既存資産との関係(先に読むもの)

- `docs/INFRA.md`: 既存リソース台帳。新しいリソースを作る前に必ず参照する
- `docs/MINIPC-SETUP.md`: 2026-07-11時点の旧移行手順。**内容が現行構成と食い違う**(後述)
- `docs/GOOGLE-MCP-SETUP.md`: google-workspace MCPの登録・初回認証・7日失効の罠
- `docs/specs/08-data.md`: DB中心データ基盤。正本と書き手の規約
- `docs/specs/13-local-credential-broker.md`: 資格情報ブローカーとDPAPIの境界
- `docs/specs/14-provider-independent-agent-runtime.md`: 抽出と決定論executorの分離。本移行の受け渡し設計はこれに揃える

### 台帳と実態のずれ(この調査で判明。移行前に直す)

| 箇所 | 台帳の記述 | 実態(2026-07-24 確認) |
| --- | --- | --- |
| `docs/INFRA.md` Windows定常タスク | katazuku-calendar-sync を30分ごとで登録済みと記載 | **未登録**。`register-calendar-sync.ps1` はあるがOSに存在しない |
| `docs/INFRA.md` Windows定常タスク | 定常タスクは5本 | 実登録は4本 + 無効化1本。加えて `katazuku-local-login`(7:40)が未登録のまま存在する |
| `docs/INFRA.md` バックアップ | `data/backups`、14日保持 | 実装は `logs/db-backup`、14日保持(`sync/scripts/db-snapshot.ts`) |
| `docs/MINIPC-SETUP.md` | `status/service-account.json` とSheets APIサービスアカウントで同期 | 現行はDB正本 + MCP(`modify_sheet_values`)ミラー。サービスアカウント経路は使っていない |

`docs/MINIPC-SETUP.md` は本仕様の完成後に「本仕様への入口」だけを残して置き換える。

## いま定常実行されているものの棚卸し

### OSに登録済みのタスク(`Get-ScheduledTask` 実測)

| タスク名 | 状態 | 起動 | 実体 | 直近結果 |
| --- | --- | --- | --- | --- |
| `katazuku-daily-sync` | Ready | 毎日 08:23 | `run-daily-sync.vbs` → `daily-sync.ps1` | 0 |
| `katazuku-asa` | Ready | 毎日 09:00 | `run-asa.vbs` → `asa-auto.ps1` | 0 |
| `katazuku-mail-watch` | Ready | 07:15から1時間ごと15時間 | `run-mail-watch.vbs` → `mail-watch.ps1` | 0 |
| `katazuku-meeting-autopilot` | Ready | 5分ごと(終日) | `run-meeting-autopilot.vbs` → `meeting-autopilot.ps1` | 0 |
| `katazuku-meeting-opener` | Disabled | (5分ごと) | `run-meeting-opener.vbs` → `open-meeting-urls.ps1` | 二重起動回避で無効 |

共通の設定と、それが移行判断に効く点。

- Principal は `okuyama` / RunLevel=Limited / **LogonType=Interactive**。
  つまり**本人がログオンしている対話セッションでしか走らない**。MiniPCは自動ログオン前提になる
- daily-sync / asa / mail-watch は `WakeToRun=True`、`StartWhenAvailable=True`。
  ただし3本とも **`DisallowStartIfOnBatteries=True`**(既定値)。
  主PCがノートでバッテリー駆動だと**そもそも起動しない**。常時AC電源のMiniPCはこの穴を塞ぐ
- meeting-autopilot だけ `WakeToRun=False` / `StartWhenAvailable=False`。
  眠っていたら会議は開かないし録音も始まらない

### 登録スクリプトはあるが未登録のもの

| 想定タスク名 | 起動 | 実体 | 状態 |
| --- | --- | --- | --- |
| `katazuku-calendar-sync` | 30分ごと | `run-calendar-sync.vbs` → `calendar-sync.ps1` | 未登録 |
| `katazuku-local-login` | 毎日 07:40 | `run-local-login.vbs` → `local-login/daily-login.ps1` | 未登録(資格情報レコードも未作成) |

### 手動・イベント起動のもの

| 名前 | 起動契機 | 実体 | 備考 |
| --- | --- | --- | --- |
| record-audio | meeting-autopilot が会議開始5分後に起動 | `scripts/record-audio.ps1` | ffmpeg + 実オーディオデバイス |
| interview-digest | record-audio の終了時、または手動 | `scripts/interview-digest.ps1` | Voicebox(ローカルWhisper、127.0.0.1:17493)必須 |
| application-autopilot / apply-company / research-company | 本人が `katazuku` CLIから | `scripts/*.ps1` | ブラウザ操作・承認ゲートあり |
| reconcile-calendar / mobility / sync-research-es | 手動 | `scripts/*.ps1` | 不定期 |
| クラウド見張りルーチン | claude.ai routine(12時間ごと) | claude.ai側 | ローカル移行の対象外 |

### 各処理が正本DBを書くか

| 処理 | DB書込 | 根拠 |
| --- | --- | --- |
| daily-sync | 書く | `db-apply` / `db-apply-mail` / `db-apply-submission` / `db-snapshot` / `db-mirror` |
| calendar-sync | 書く | `db-apply-calendar` / `db-snapshot` |
| asa | 書く | `db-apply` / `db-snapshot` / `db-mirror` / `db-link-calendar` |
| meeting-autopilot | 書く | `db-meeting-run` / `db-meeting-done` / `db-snapshot` |
| interview-digest | 書く | `db-apply-interview` |
| mail-watch | **書かない** | 下書き・カレンダー・トースト・`logs/mail-watch-state.json` のみ |
| local-login | 書かない | `logs/local-login-*.log` のみ |

この表が移行設計の骨になる。**DBを書く処理は、正本DBが置かれた1台の上でしか動かしてはいけない。**

## 仕分け: どこで動かすか

判定は3つ。`H` = ヘッドレスでMiniPCへ移せる。`D` = 対話デスクトップが必要(MiniPC上でも自動ログオンした
セッションが要る、または本人の在席が要る)。`M` = 主PCに残す。

| 処理 | 判定 | 理由 |
| --- | --- | --- |
| daily-sync | H | `claude -p` + MCPのみ。画面もデバイスも要らない。DBを書くので**正本と同じ機械**に置く |
| calendar-sync | H | 同上。まず未登録を解消してからMiniPCへ |
| asa | H | 同上。結果は本人宛メールで届くので画面不要 |
| mail-watch | H(注) | DBを書かないので移設は容易。ただしWindowsトースト通知はMiniPC画面に出て**本人に見えない**。通知経路の代替(Discord)が要る |
| local-login | D | 隔離プロファイルのChromeを起動する。ヘッドレス起動でもWindowsの対話セッションが要る。MiniPCの自動ログオンセッションで可。**DPAPI資格情報は移せず、MiniPCで再登録が必要** |
| db-mirror(シート書込) | H | daily-sync/asa の中で走る。google-workspace MCP接続が前提 |
| db-snapshot(アプリ反映・Vercel push) | H | `.env` の書込用合言葉が要る。DBと同じ機械で走る |
| meeting-autopilot(URLを開く) | M | 会議URLを**本人が座っている画面**で開く必要がある。MiniPCで開いても意味がない |
| record-audio(面接録音) | M | 実マイク・実スピーカーが要る。相手の声は本人の使う出力デバイスに出る。移設不可 |
| interview-digest(文字起こし) | H寄りのD | Voiceboxがローカルサーバー(GUIアプリ)。MiniPCの自動ログオンセッションなら動く見込み。CPU負荷が高く、実測してから移す |
| Chromeによるブラウザ操作(応募・ES提出・マイページ) | D | ノートPCに固定する。ログイン済みChrome、Downloads添付、本人の承認操作を同じ端末内で完結させる |
| 資格情報ブローカーの登録(`store-credential.ps1`) | D | 本人がSecureStringで入力する。DPAPI CurrentUserなので**登録した機械でしか復号できない** |
| 対話認証が要るMCP(google-workspace初回OAuth、claude.aiログイン) | D | ブラウザ同意が要る。MiniPCの画面で1回やる(リモートデスクトップ経由でも可) |
| クラウド見張りルーチン | 対象外 | claude.ai側で動く |

### 「主PCに残す」の中身を減らす道筋

`M` に残るのは実質「会議を開く」「面接を録る」の2つだけである。

- **会議を開く**: MiniPCの正本DBから予定を読む必要があるが、書き込みは要らない。
  既に公開されている読み取り経路(`/api/data?key=...` のsnapshot)を使えば、主PC側は
  **読み取り専用**で「10分前になったらURLをStart-Processで開く」だけの軽量タスクにできる。
  無効化済みの `open-meeting-urls.ps1` を snapshot 読みに作り替えるのが最小改修
- **面接を録る**: 移設しない。録音成果物(wav)だけをMiniPCへ渡し、
  文字起こしとDB反映はMiniPC側で行う(受け渡し方式は後述)

## MiniPC側に必要なもの

### ハードウェアと電源

- 常時AC電源。スリープ・休止を無効(電源プランで「スリープしない」「ハイブリッドスリープ無効」)
- 有線LAN推奨。Wi-Fi省電力でスケジュール実行が落ちるのを避ける
- ディスクはSQLiteとログ、面接wav、Voiceboxモデルで数十GB。SSD 256GB以上
- CPUはVoiceboxのWhisperを載せるなら効いてくる。載せない構成なら非力でよい

### OSと設定

| 項目 | 要件 | 理由 |
| --- | --- | --- |
| OS | Windows 11(Home可) | スクリプトがPowerShell 5.1 + タスクスケジューラ + DPAPI前提 |
| 自動ログオン | 有効(`netplwiz` または Autologon) | 登録タスクが LogonType=Interactive のため、ログオンセッションが無いと走らない |
| ロック画面 | 起動後は施錠しない運用 | 施錠だけならセッションは維持されるが、Chrome操作・録音系は解錠が要る |
| タイムゾーン | (UTC+09:00) 大阪、札幌、東京 | 全スクリプトがJST前提。曜日は必ずJSTで検算する規約 |
| 地域と言語 | 日本語(日本)。**「ベータ: UTF-8を使用」は有効にしない** | 主PCと同じCP932環境に揃える。ANSIコードページを変えると、既存のログ判定・ffmpegのデバイス名処理の挙動が主PCと変わる |
| ディスク暗号化 | BitLocker/デバイス暗号化を有効 | 自動ログオン運用は物理アクセス=全権限になるため、盗難対策を別に持つ |
| Windows Update | 自動再起動のアクティブ時間を夜間から外す | 再起動後も自動ログオンで復帰することを確認する |

### ソフトウェア

| ソフト | 版・入手 | 用途 | 必須 |
| --- | --- | --- | --- |
| Git for Windows | 最新 | クローン、Bashツール | 必須 |
| Node.js | **24.16.0**(`.node-version` / `engines: >=24 <25`) | `node:sqlite` が experimental のため版固定が正本の安全に直結する | 必須 |
| Claude Code CLI | `npm i -g @anthropic-ai/claude-code` | 全ルーチンの実行役 | 必須 |
| uv / uvx | 主PCは `~/.local/bin/uvx` | google-workspace MCP(`uvx workspace-mcp`)の起動に要る | 必須 |
| Google Chrome | 最新 | local-login の隔離プロファイル、将来のブラウザ操作 | 必須 |
| ffmpeg | `winget install Gyan.FFmpeg` | interview-digest のチャンク分割 | digestを移す場合 |
| Voicebox | ローカルWhisper。ポート17493。`turbo` モデルをDL済みにする | interview-digest の文字起こし | digestを移す場合 |
| Codex CLI | 任意 | agent-runtime のフォールバックprovider | 任意 |

`.node-version` があるので、fnm/volta等の版管理を入れて自動追従させると事故が減る。

### 認証(すべて本人操作が要る。ここが移行の実質的なコスト)

| 対象 | やること | 備考 |
| --- | --- | --- |
| Claude Code | `claude` を対話起動して laboauto12@gmail.com でログイン | 主PCと同一アカウント。**2台同時稼働で利用枠を共有する**ことを見込む |
| google-workspace MCP | `claude mcp add google-workspace --scope user`(`docs/GOOGLE-MCP-SETUP.md`)+ 対話でツールを1回呼びブラウザ同意 | OAuthクライアントID/シークレットは `~/.claude.json` に入る。**リポジトリに書かない** |
| OAuth同意画面 | 「アプリを公開」状態を確認 | テストのままだとリフレッシュトークンが**7日で失効**し、週1で人手が要る。無人運用の最大の敵 |
| claude.ai コネクタ(`mcp__claude_ai_*`) | 期待しない | headlessでは不安定。MiniPCでは google-workspace を一次手段にする |
| Voicebox | 起動とモデルDL | 使う場合のみ |
| 資格情報ブローカー | MiniPC上で `store-credential.ps1` を本人が実行 | DPAPI CurrentUserのため**主PCの `credential-store/` はコピーしても復号できない** |
| 各ポータルの初回ログイン | `daily-login.mjs --portal <id> --headful` をMiniPCで1回 | MFA/CAPTCHAをその場で通し、隔離プロファイルにセッションを作る |

### gitに入らない持ち込みファイル

`git clone https://github.com/kokotatan/katazuku-shukatsu.git` では以下が入らない。
USB等で直接コピーする(チャット・メール添付は使わない)。

| 対象 | 中身 | 必須 |
| --- | --- | --- |
| `.env` | snapshot配信の読み書き合言葉(`KATAZUKU_READ_SECRET` / `KATAZUKU_WRITE_SECRET`) | 必須 |
| `data/katazuku.db` | 正本DB。移設方針は次節 | 必須 |
| `data/private/photos` | 人物・証明写真 | 必須(peopleアプリを使うなら) |
| `logs/activity-log.jsonl` | 活動ログの履歴 | 推奨(継続性のため) |
| `logs/mail-watch-state.json` | 処理済みメールID。無いと二重処理する | 推奨 |
| `chrome-prompts/*.local.md` | 提出台帳・プロフィール(`submit.local.md` が事実の正) | 応募・ES系を動かすなら必須 |
| `self-wiki.local.md` ほか `*.local.md` | 素材集 | 任意 |
| `credential-store/` | **コピーしない**(DPAPIで復号不可) | 再登録する |

加えて、いま主PCで作業中のブランチが `origin` に無い(`main` と `sheet-sync-new-tabs` のみpush済み)。
移行前に必要なブランチをpushするか、作業ツリーごとコピーする。

### 文字コードとロケールの罠(既知の事故に基づく)

- `.ps1` は**UTF-8 BOM付きで保存する**。PowerShell 5.1 はBOMが無いUTF-8をCP932として読むため、
  日本語コメント・文字列が化けて挙動が変わる。gitはBOMを保持するのでクローンなら問題ないが、
  MiniPC上でエディタが勝手にBOMを落とす設定になっていないか確認する
- ログの完了判定は**半角ASCIIのセンチネル**(`=== daily-sync DONE ===` / `=== asa DONE ===` /
  `=== calendar-sync DONE ===`)で行う。日本語の「完了」は文字コード次第で化け、
  正常なのに故障と誤報した実績がある(2026-07-15/16)
- プロンプトは `claude -p` の引数でなく**stdinで渡す**。本文中の `-Why "..."` 等が
  PowerShellの引数分割で未知オプションと誤認され起動失敗した実績がある(2026-07-18)
- `Out-File -Encoding utf8` は PowerShell 5.1 ではBOM付きで書く。判定側の正規表現をこれに合わせてある
- ffmpeg に日本語デバイス名を渡すと開けないことがあるため、`record-audio.ps1` は代替名で扱う。
  MiniPCへ録音を移さない限りこの罠は踏まない

## 正本DB `data/katazuku.db` の扱い

### 原則

1. **正本は常に1ファイル・1台**。二重書き込みを防ぐ唯一確実な方法は、書き手が動く機械を1台に限ること
2. **ファイル同期(OneDrive / Dropbox / Syncthing 等)でDBを共有しない**。SQLiteはWALと共有メモリ
   (`katazuku.db-wal` / `katazuku.db-shm`)を伴い、同期ツールの部分コピー・衝突コピーで容易に壊れる
3. **ネットワーク共有(SMB)上のDBを両機から開かない**。SQLiteのロックはSMBで信頼できない
4. 読みたいだけの側は、既にある**snapshot経路**(`/api/data?key=...`)を使う。これは設計上すでに
   「見る窓」であり、読み取りのために正本を共有する必要はない

### 決定: MiniPCを正本の持ち主にする

移行完了後の姿。

~~~text
MiniPC(常時稼働・唯一の書き手)
  data/katazuku.db  ← daily-sync / calendar-sync / asa / interview-digest / 会話
        |
        +--> db-snapshot --> /api/push --> Vercel Blob --> アプリ群 / 主PC(読み取り)
        +--> db-mirror  --> Googleシート(一方向ミラー)
        +--> logs/db-backup/katazuku-YYYY-MM-DD.db(14日保持)

主PC(在席時のみ・DBを書かない)
  会議URLを開く(snapshotを読むだけ)
  面接を録音する(wavを出力)
        |
        +--> 受け渡しフォルダ --> MiniPCが取り込み、DBへ反映
~~~

主PC側では、移行後に以下を守る。

- `katazuku-daily-sync` / `katazuku-asa` / `katazuku-mail-watch` / `katazuku-meeting-autopilot` を
  **Disable する(削除しない)**。切り戻しが1コマンドで済む
- リポジトリの `data/katazuku.db` を `data/katazuku.db.retired-YYYYMMDD` へ改名して退避する。
  誤って主PCで `db-apply-*` を実行しても、空DBが新規作成されるだけでミラーやpushには進まない
- 本人が主PCで対話的にagentを動かすときは、DBを書く操作をしない。書きたい話は
  Discordブリッジ(後述)かリモートデスクトップ経由でMiniPCのagentへ渡す

### 移設手順(データを壊さないやり方)

1. MiniPC側で全katazukuタスクを未登録のままにしておく
2. 主PCで全katazukuタスクを Disable し、走行中のものが無いことを確認する
3. 主PCで `cd sync; npx tsx scripts/db-snapshot.ts` を実行する。
   ここで `PRAGMA integrity_check` が走り、`logs/db-backup` に当日のバックアップが取られる
4. WALを畳んでからコピーする。`katazuku.db` 単体をコピーすると未チェックポイントの更新が失われうる。
   `data/katazuku.db` `data/katazuku.db-wal` `data/katazuku.db-shm` を**3点セットで**コピーするか、
   SQLiteの `VACUUM INTO` 相当で単一ファイルへ書き出してから運ぶ
5. MiniPCで `cd sync; npx tsx scripts/db-inspect.ts` を実行し、件数(選考・企業・予定)が
   主PCの最終値と一致することを確認する
6. MiniPCで `npx tsx scripts/db-snapshot.ts --no-push` を実行して integrity_check が ok になることを確認し、
   その後 push ありで1回実行してアプリに反映されることを確認する
7. 主PCのDBを退避(改名)する

### バックアップ

| 層 | 中身 | 保持 | 置き場 |
| --- | --- | --- | --- |
| 日次(自動) | `db-snapshot` 実行時に `logs/db-backup/katazuku-YYYY-MM-DD.db` | 14日 | MiniPCローカル |
| 週次(追加・要実装) | 上記の最新をMiniPC外へコピー | 4週 | 主PCの `logs/db-backup-from-minipc/` へ、Tailscale経由でpull |
| 事故時 | snapshot(`data/snapshot.json`)とシートミラー | 直近 | 完全復元ではないが、選考・企業・予定の再構築材料になる |

- `data/` と `logs/` はgitignore。**gitには絶対に載せない**。退避先も同じ扱いにする
- 退避コピーの転送は Tailscale の tailnet 内に閉じる。パブリッククラウドへ生DBを置かない
- 個人情報の観点では、MiniPCも主PCも「個人データを持つ端末」である。BitLockerを両方で有効にする

### 二重書き込みを防ぐ仕掛け(実装候補)

規約だけでは事故る。安い順に。

1. **退避改名**(即実装可、コスト0): 主PCの `data/katazuku.db` を改名する。上記手順に含める
2. **所有者マーカー**(小): `data/OWNER` に機械名を書き、`sync/src/db.ts` の `openDb` が
   ホスト名と一致しなければ書込系を拒否する。読み取り(`db-inspect`)は許す。
   `check-db.ts` に回帰1件を足す
3. **単一実行ロック**(小): 既に `.claude/scheduled_tasks.lock` の前例がある。
   MiniPC上でも daily-sync と asa が重なると同じDBへ同時書込になりうるため、
   `logs/db-write.lock` によるプロセス間排他を入れておくと安全側に倒れる

2 と 3 は本移行の必須ではないが、Phase 1 の完了条件に 2 を含めることを推奨する。

## 主PC ↔ MiniPC の受け渡し(面接録音)

録音は主PCに残り、DB反映はMiniPCで行う。spec14の「抽出(read-only)→決定論executor」と同型にする。

~~~text
主PC: record-audio.ps1
   → logs/handoff-out/<予定ID>-<日時>.wav  を出力
   → Tailscale経由で MiniPC の logs/handoff-in/ へコピー(またはMiniPCがpull)

MiniPC: 取り込みタスク(15分ごと)
   → interview-digest.ps1(Voiceboxで文字起こし)
   → 厳格JSON
   → db-apply-interview.ts(1トランザクション。event.ref=run_idで冪等)
   → db-snapshot.ts
~~~

- ファイル名に予定IDを含め、`db-apply-interview` の冪等キーに繋げる。二重取込を防ぐ
- 取り込み済みのwavは `logs/handoff-in/done/` へ移す。消さない(聞き直し用)
- wavは個人情報。tailnet内の転送に限る。クラウドストレージを経由させない
- Voiceboxの負荷が許容できなければ、**digestまで主PCで完結**させ、
  受け渡しを「厳格JSONだけ」にしてもよい(転送量も小さく、こちらのほうが安全側)

## Discordブリッジ(最小構成)

### 狙い

スマホのDiscordから「いま何が進行中?」「この会社に返信して」と話しかけ、
MiniPC上のagentが処理して返す。加えて、mail-watch の Windows トースト通知が
MiniPCの画面に出て見えなくなる問題の**代替通知路**になる。

### 構成

~~~text
スマホ Discord
   |  (DM。プライベートサーバの1チャンネルでも可)
   v
Discord Gateway
   |  WebSocket(送信元はMiniPCからの発信接続のみ。ポート開放なし)
   v
MiniPC 常駐プロセス scripts/discord-bridge.mjs
   - 送信者IDが本人1名のallowlistに一致するかを検証
   - 1件ずつ直列に処理(同時実行しない = DB二重書込を作らない)
   - katazuku-agent-runner 経由で workflow を起動
   - 危険操作は「承認待ち」にしてDiscordへ確認を返す
   v
data/katazuku.db / 各 db-apply-* / 活動ログ
~~~

### 必要なもの

| 項目 | 内容 |
| --- | --- |
| Discord Bot | Discord Developer Portal でアプリ+Bot作成。**MESSAGE CONTENT INTENT を有効化** |
| 招待先 | 本人だけの非公開サーバ(1チャンネル)。DM運用でも可 |
| トークン | `.env` の `DISCORD_BOT_TOKEN`(gitignore済)。将来的にはDPAPIへ寄せる |
| allowlist | `.env` の `DISCORD_OWNER_ID`(本人のDiscordユーザーID)。**一致しない発言は無視し、返信もしない** |
| 実行 | Node常駐。タスクスケジューラの「ログオン時に開始」+ 異常終了時の再起動設定、または NSSM 等でサービス化 |
| ライブラリ | discord.js。依存を増やしたくなければ Gateway WebSocket を直接叩く実装でもよい |

### 権限とスコープ

- Botに与えるのは `Send Messages` / `Read Message History` / `Attach Files` 程度。
  管理権限、メンバー管理、他サーバへの参加は与えない
- 公開サーバへ入れない。招待リンクを再利用しない
- Botは**入力を受け取るだけで、外部への送信権限を自動で得るわけではない**。
  Gmail送信・応募送信などの外向き副作用は下記の承認ゲートを通す

### 危険な操作の承認(既存の境界を壊さない)

現行の運用規約をそのままブリッジ上に写す。

| 区分 | 例 | ブリッジでの扱い |
| --- | --- | --- |
| 自動でよい | 状況照会、DBの読み取り、下書き作成、カレンダー登録、企業研究、活動ログ記録 | そのまま実行して結果を返す |
| 本人の明示承認が要る | 企業・採用担当へのメール送信、応募の確定送信、ES提出、辞退、面接予約の確定、購入、削除(DBレコード・ファイル)、資格情報の登録 | agentは実行せず、**本文全文**をDiscordへ提示し、本人が `承認 <ID>` と返すまで待つ。承認は時限(例: 15分)で失効させる |

外部確定操作を一律禁止するのではなく、すべてを同じ事前検査へ通す。定型の受諾・受領確認・日程回答は
`docs/mail-style.md`の委任範囲内で自動送信できる。本人の意思を新たに決める操作は、対象・内容・操作IDを
本人が確認した後に実行する。確定前には、元の外部状態、MiniPCの正本DB、予定の同期鮮度、
同一thread/sourceRefと内容hashの成功記録、相手に不要な第三者情報が本文へ含まれていないことを照合する。
成功済み・成否不明の操作は再実行しない。Gmail/Calendarの直接コネクタは確定操作に使わず、
この検査と冪等化を強制するworkflow/Executorだけに送信・確定権限を与える。
| 常に不可 | Webテスト・コーディングテストの代行受験、パスワードの平文取得・表示 | 実行しない。理由を返す |

- 承認待ちは `application_run` / `application_event` の既存の承認ゲートに寄せる。
  ブリッジ独自の承認台帳を作らない
- 「メール送信可否は本文全文を見せてから聞く」という既存規約をそのまま適用する
- 本人宛サマリの送信(asaの「きょうやること」)だけは従来どおり自動でよい

### 段階

1. **読み取り専用**から始める。`/status` `/today` `/log` など、DBを読むだけのコマンド
2. 通知の受け皿にする(mail-watchの緊急通知、alert-*.txt の故障通知)
3. 書き込みと承認ゲートを開ける

## リモートアクセスの選択肢

**前提の確認**: 主PCは Windows 11 Home。Home Edition は **RDPのホスト(受け側)になれない**。
MiniPCもHomeで組むなら、素のRDPは選べない。Proへ上げるか、別方式を使う。

| 方式 | 到達性 | Windows Home | 体感 | 音声 | 費用 | 評価 |
| --- | --- | --- | --- | --- | --- | --- |
| Tailscale + RDP | tailnet内で直結 | **ホスト不可**(Pro必要) | 良好 | 可 | Tailscale個人無料 + Pro代 | Proに上げるなら最有力 |
| Tailscale + RustDesk(自前relay不要、直結) | tailnet内で直結 | 可 | 良好 | 可 | 無料/OSS | **Homeのまま使える現実解** |
| Chrome リモート デスクトップ | Google経由 | 可 | 普通 | 制限あり | 無料 | 導入が最も簡単。認証がGoogleアカウントに寄る |
| Parsec | P2P | 可 | 非常に良い(低遅延) | 可 | 個人無料 | 画面操作の快適さは随一。常時稼働ホストとしても実績あり |
| AnyDesk / TeamViewer | ベンダー中継 | 可 | 良好 | 可 | 個人無料枠あり | 商用利用判定でブロックされることがある |
| Tailscale + SSH / PowerShell Remoting | tailnet内 | 可 | CUIのみ | 不可 | 無料 | ログ確認・タスク再実行だけならこれで足りる |

### 推奨

- **ネットワーク層は Tailscale で確定**。ポート開放をしない、固定IPを要求しない、
  スマホからも同じtailnetに入れる。ファイル受け渡し(録音wav、DBバックアップ)にも使い回せる
- **画面が要るとき**は、まず **Tailscale + RustDesk**(または Parsec)。Homeのまま追加費用なしで始められる。
  将来MiniPCをProにするなら RDP へ寄せてもよい
- **画面が要らない日常運用**は Tailscale + SSH(OpenSSHサーバはWindows Homeでも入る)。
  `Get-ScheduledTaskInfo` の確認、ログのtail、タスクの再実行はこれで足りる
- Tailscale のACLで、主PC・MiniPC・スマホの3台に限定する。Exit nodeやsubnet routerは有効にしない

## 移行手順(フェーズ分割)

各フェーズは「完了条件を満たすまで次へ進まない」「切り戻しが1手で済む」ことを守る。

### Phase 0: 準備(実機作業なし)

やること。

1. `docs/INFRA.md` の台帳ずれ(calendar-sync未登録、local-login未登録、バックアップ先)を修正する
2. `docs/MINIPC-SETUP.md` を本仕様への入口に置き換える
3. `katazuku-calendar-sync` を**主PCで先に登録して1週間動かす**。
   未検証のタスクをMiniPCの初期構成に混ぜない
4. 必要なブランチを `origin` へpushする
5. 二重書き込み防止の「所有者マーカー」(前述の実装候補2)を実装し、`check-db.ts` に回帰を足す

完了条件: 上記5点。切り戻し: すべてリポジトリ内の変更なのでgitで戻せる。

### Phase 1: ヘッドレス系をMiniPCへ

対象: `daily-sync` / `calendar-sync` / `asa` / `mail-watch` / (任意で `local-login`)、および**正本DB**。

手順。

1. MiniPCをセットアップする(OS設定、自動ログオン、電源、ロケール、BitLocker)
2. Node 24.16.0 / Git / Claude Code / uv / Chrome を入れる
3. `git clone` し、`npm run build` が通ることを確認する(ビルド+全チェックが緑になるまで先へ進まない)
4. `claude` にログインし、google-workspace MCP を登録・初回OAuth同意を通す。
   `claude mcp list` が Connected を返すことを確認する
5. headlessでMCPが使えることを単体確認する。
   `"gmailで未読を1件検索して件数を報告"` を `claude -p` に流して結果が返ること。
   **ここが通らないとdaily-syncは空回りする**(過去に鍵不在で丸ごと空回りした前例あり)
6. 秘密ファイル(`.env`、`*.local.md`、`data/private/photos`、`logs/activity-log.jsonl`、
   `logs/mail-watch-state.json`)をUSBでコピーする
7. 主PCの全katazukuタスクを Disable する
8. 前述の手順でDBを移設し、`db-inspect` の件数一致を確認する
9. MiniPCで各スクリプトを**手動で1回ずつ**実行し、完了センチネルが出ることを確認する
   (`daily-sync.ps1` → `=== daily-sync DONE ===`、`asa-auto.ps1` → `=== asa DONE ===`、
   `calendar-sync.ps1` → `=== calendar-sync DONE ===`)
10. `register-all-tasks.ps1` + `register-calendar-sync.ps1` でタスクを登録する。
    `meeting-autopilot` は**登録しない**(主PCに残す)
11. 主PCの `data/katazuku.db` を退避改名する
12. 主PCには「会議URLを開くだけ」の軽量タスクを置く(snapshot読み。要小改修)

完了条件。

- MiniPCで3日連続、daily-sync / asa / calendar-sync が完了センチネル付きで成功する
- 「きょうやること」メールが毎朝届く
- 選考管理シートのミラーが更新されている(google-workspace MCPが本当に繋がっている証拠)
- `logs/db-backup` に日次バックアップが増えている
- 主PCで `db-inspect` を叩いても、退避済みで正本を触っていない
- 会議のURLが主PCで10分前に開く

切り戻し。

- MiniPCの5タスクを Disable する
- 主PCの退避DBを元名に戻し、Disableした4タスクを Enable する
- MiniPCで発生した差分は、MiniPC側DBをコピーして主PCへ戻す(退避DBに上書きしない。日付付きで並べて比較する)

### Phase 2: Discordブリッジ

1. Bot作成、非公開サーバ、allowlist、`.env` へトークン(本人が入れる)
2. `scripts/discord-bridge.mjs` を**読み取り専用**で実装し、ログオン時起動タスクとして常駐させる
3. 通知の受け皿にする(mail-watchの緊急、`logs/alert-*.txt` の故障通知)
4. 書き込み+承認ゲートを開ける。承認は本文全文提示 + 時限失効

完了条件: スマホから状況照会が返る。緊急通知がDiscordに届く。
承認が要る操作で、承認せずに実行されたケースが1件も無い(ログで確認)。

切り戻し: 常駐タスクを停止する。ブリッジは他の経路に依存されていないので影響は閉じる。

### Phase 3: リモート運用

1. Tailscale を主PC・MiniPC・スマホに入れ、ACLを3台に限定する
2. MiniPCへOpenSSHサーバを入れ、tailnet内からのみ到達できることを確認する
3. ノートPCに `.katazuku-satellite` を置き、`invoke-minipc-db.ps1` のagenda取得・JSON反映を確認する
4. MiniPC側ではgoogle-workspace MCPの初回OAuthだけを対話セッションで通す
5. 面接録音の成果物と厳格JSONをtailnet越しに渡し、DB反映とsnapshotだけMiniPCで行う

完了条件: ノートPCのChrome・Downloadsで応募作業が完結し、提出後のJSONだけがSSH経由で
MiniPCの正本DBへ冪等反映される。ノートPCでローカル正本DBを開こうとするとガードで失敗する。

切り戻し: MiniPC側の定常タスクを停止し、日付付きで退避したノートPCのDBを、差分確認後に
正本名へ戻す。退避DBへ直接上書きはしない。

## リスクと未解決事項

| # | リスク・論点 | 影響 | 現時点の対処 |
| --- | --- | --- | --- |
| 1 | **MCPの対話認証が無人環境で切れる**。OAuth同意画面がテスト状態だとリフレッシュトークンが7日で失効 | daily-sync/asaが静かに部分失敗する | 同意画面を「公開」にする。失効時は `alert-*.txt` → asa → (Phase2以降は)Discordで気づけるようにする |
| 2 | **daily-syncのMCP依存ギャップ**(既知)。シートミラー書込と受信一括整理は google-workspace MCP 必須で、claude_ai コネクタだけの環境では保留になる | 完了行が出ず、正常でも故障と誤報される | MiniPCでは google-workspace を一次手段にする。Phase 1 の完了条件に「シートミラーが更新されること」を入れてある |
| 3 | **Claude Code を2台で使うことによる利用枠の共有・同時実行** | 枠切れで両方止まる | MiniPCへ寄せ、主PCの定常タスクはDisableする(同時に走らせない)。agent-runtimeのproviderフォールバックが保険 |
| 4 | **自動ログオン運用のセキュリティ** | 物理アクセス=全権限。個人情報とDPAPI資格情報がある | BitLocker有効化、設置場所の管理、tailnet限定の到達性 |
| 5 | **DPAPI資格情報が移せない** | local-loginの有効化に本人作業が必須 | Phase 3 でMiniPC上で再登録する。主PCの `credential-store/` はコピーしない |
| 6 | **録音は主PCに残る**。さらに現状、相手の声(システム音声)がステレオミキサーで拾えず、VB-CABLE等の仮想オーディオ導入が未了 | 面接の相手側音声が録れない既知の欠陥が残る | 本移行とは独立の課題。`record-audio.ps1` 末尾のTODOに手順あり。導入は本人同意が要る |
| 7 | **Voiceboxの移設可否が未検証** | interview-digestの置き場所が決まらない | Phase 3 で実測する。負荷が重ければdigestは主PCに残し、受け渡しを厳格JSONだけにする |
| 8 | **meeting-autopilotの分割改修が未実装** | Phase 1 で会議自動運転が一時的に手薄になる | `open-meeting-urls.ps1` を snapshot読みへ改修する小タスクを Phase 1 に含める。録音の自動起動は当面手動 |
| 9 | **クラウド露出(spec08の未決事項)** | snapshotに面接メモ・人物名等が入りVercel Blobへ出る。読み取りは合言葉1本 | 本移行で状況は変わらないが、**MiniPCが常時pushする分だけ露出の頻度は上がる**。判断は据え置き |
| 10 | **共有origin対策(spec13 残作業3)が未実装** | 実ポータルでのブローカー有効化はまだ危険 | Phase 3 の local-login 有効化の前提条件にする |
| 11 | Windows Updateの再起動後に自動ログオンが復帰しない可能性 | 無人運用が静かに止まる | Phase 1 の完了条件に「再起動後に自動で全タスクが復帰する」ことを含める。死活監視(後述)で検出する |
| 12 | 死活監視が無い | MiniPCが落ちても気づかない | 最小案: MiniPCが毎朝 `logs/alert-*.txt` の有無と最終実行時刻をDiscord/メールで報告する。Phase 2 で実装 |

## 本人に決めてもらう論点

1. **MiniPCのWindowsエディション**。Home のままなら RDP は使えず、RustDesk / Parsec / Chrome リモート
   デスクトップのいずれかになる。Pro へ上げるなら RDP が最も素直
2. **面接の文字起こし(Voicebox)をMiniPCへ移すか**。移すならCPU性能が要る。
   移さないなら受け渡しは厳格JSONだけで済み、MiniPCは非力でよい
3. **Phase 1 で会議自動運転をどう扱うか**。
   (a) 主PCに「開くだけ」の軽量タスクを置いて録音は手動起動、
   (b) 会議系はPhase 3 まで完全に主PC据え置き(=DB書込のためPhase 1 でDBを移せない)、
   のどちらか。本仕様は (a) を前提に書いている
4. **Discordブリッジの承認スタイル**。ボタン(Discordのコンポーネント)か、`承認 <ID>` のテキスト返信か。
   テキスト返信のほうが実装が軽く、誤タップが起きにくい
5. **spec08の未決事項(クラウド露出)を移行前に片付けるか**。
   MiniPCが常時pushするようになると、露出の頻度と鮮度が上がる
