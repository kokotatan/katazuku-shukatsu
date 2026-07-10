# miniPC 移行セットアップガイド

このリポジトリをminiPC(Windows想定)に移して、**毎朝の「就活メール→選考管理シート同期」を無人で回す**ための手順。
上から順にやれば動く状態になる。所要 30分くらい。

## 全体像

```
毎朝8:23 Windowsタスクスケジューラ
  → scripts/daily-sync.ps1
    → claude -p (scripts/daily-sync-prompt.md)
      → Gmail MCP で直近1日のメールを分析
      → status/sheet-import-loop.json に企業・選考日を書き出し
      → status/scripts/sheet-sync.ts で選考管理シートに書き込み(dry-run→apply)
    → logs/sync-*.log に実行ログ
```

費用はゼロ(Sheets API・サービスアカウントは無料。claude -p は契約中のプラン内で動く)。

## 1. 必要ソフトのインストール

1. **Git**: https://git-scm.com/download/win
2. **Node.js LTS**: https://nodejs.org/ (v20以上)
3. **Claude Code**: `npm install -g @anthropic-ai/claude-code`
4. Claude Code にログイン: ターミナルで `claude` → ブラウザが開くので **laboauto12@gmail.com** のアカウントでログイン

## 2. リポジトリを持ってくる

GitHubにprivateリポジトリとしてpushしてある場合:

```powershell
git clone <リポジトリURL> C:\katazuku-shukatsu
cd C:\katazuku-shukatsu
npm run build   # 依存インストール+ビルドが通ることを確認
```

(まだリモートが無い場合は、ノートPC側で先に `gh repo create katazuku-shukatsu --private --source . --push` するか、フォルダごとUSB/クラウドドライブでコピーする)

## 3. gitに入っていない秘密ファイルを手動コピー

以下は個人情報・秘密情報なのでgitignoreされている。**ノートPCから直接コピーする**(USBなど。チャットやメール添付は避ける):

| ファイル | 用途 | 必須? |
|---|---|---|
| `status\service-account.json` | シート書き込みの鍵 | **必須** |
| `inbox\gmail-import-*.json` | Inboxアプリの実メールデータ | 任意 |
| `chrome-prompts\_profile.local.md` | ブラウザ操作プロンプト用プロフィール | 任意 |

## 4. サービスアカウント鍵(まだ作っていない場合)

1. [Google Cloud Console](https://console.cloud.google.com/)(careerアカウント)→ プロジェクト作成
2. 「APIとサービス」→ ライブラリ → **Google Sheets API を有効化**
3. 「IAMと管理」→「サービスアカウント」→ 作成(名前は `katazuku-sync` など)
4. 作成したサービスアカウント →「キー」タブ → 鍵を追加 → **JSON** → ダウンロード
5. ダウンロードしたファイルを `status\service-account.json` という名前で保存
6. **選考管理シート**(「選考管理シート_奥山彪太郎」)の共有に、サービスアカウントのメールアドレス
   (`xxx@xxx.iam.gserviceaccount.com`)を**編集者**で追加

確認:

```powershell
cd C:\katazuku-shukatsu\status
npx tsx scripts/sheet-sync.ts sheet-import-loop.json   # dry-run。「シートにアクセスできません」が出なければOK
```

(`sheet-import-loop.json` が無ければ `[]` だけ書いたファイルを作って試す)

## 5. Gmail MCP(claude.aiコネクタ)の確認

> 【2026-07-10 注記】現在の一次手段は claude.ai 直結コネクタ(`mcp__claude_ai_Gmail__*` 等)。
> 自前 workspace-mcp(`mcp__google-workspace__*`)は登録済みだが認証が不安定で、スクリプトの
> allowedTools は両対応にしてある(scripts/daily-sync.ps1 / open-meeting-urls.ps1)。
> 本節と後述トラブルシュートの「/loop 24h に切替(週1再設定)」は最終手段の旧手順として残す。

Gmailコネクタは **claude.aiアカウントに紐づく**ので、同じアカウントでログインすれば追加設定なしで使えるはず。

```powershell
claude
> /mcp     # Gmail が接続済み(okuyama.kotaro.career@gmail.com)になっているか確認
```

## 6. タスクスケジューラ登録

管理者でなくてOK。PowerShellで:

```powershell
schtasks /Create /TN "katazuku-daily-sync" `
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File C:\katazuku-shukatsu\scripts\daily-sync.ps1" `
  /SC DAILY /ST 08:23
```

- 時刻は好みで変更可。PCがスリープしていると動かないので、**電源設定でスリープをオフ**にしておく(miniPCなら常時稼働でOK)
- 削除したいとき: `schtasks /Delete /TN "katazuku-daily-sync" /F`

## 7. 動作確認(初回は必ず手動で)

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File C:\katazuku-shukatsu\scripts\daily-sync.ps1
Get-Content C:\katazuku-shukatsu\logs\sync-*.log -Tail 30   # 結果サマリを確認
```

選考管理シートを開いて、出願状況・〆切が意図通り更新されているか目視確認する。

## トラブルシュート

- **「Gmail MCP が使えないため同期をスキップ」とログに出る**
  → headless(`claude -p`)でclaude.aiコネクタが使えないケース。対話セッションで `claude` を開きっぱなしにして
  `/loop 24h ...`(scripts/daily-sync-prompt.md の内容)を設定する方式に切り替える。
  ループは7日で失効するので週1で再設定が必要。
- **「シートにアクセスできません (403)」**
  → シートがサービスアカウントのメールに編集者共有されていない。手順4-6を確認。
- **claude が認証エラー**
  → `claude` を一度対話で起動してログインし直す。
- **書き込み内容がおかしい**
  → `logs/` のdry-run差分を確認。シート側の 合格/不合格/辞退・メモ・数式列はスクリプトが触らない設計
  (`status/src/lib/sheet.ts`)。ロジックの検証は `cd status && npx tsx scripts/check-sheet.ts`。

## このリポジトリの全体像(参考)

- `inbox/` — メール自動仕分けSPA(katazuku.kotalab.com/inbox/ 予定)
- `status/` — 選考管理カンバン(同 /status/)。「⬆ インポート」「📤 シートに反映」あり
- `landing/` — トップページ
- `chrome-prompts/` — Claude in Chrome用のマイページ操作プロンプト集
- `scripts/` — ビルド組立・毎日同期
- `docs/PROGRESS.md` — 開発進捗の詳細
- 進捗の一次情報はGoogleシート「katazuku 開発進捗」(careerアカウントのドライブ)
