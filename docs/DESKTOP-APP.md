# デスクトップアプリ(開発者でなくても使える katazuku)— 設計

状態: **設計 + 骨組み**(`desktop/`)。まだ配布物はありません。

## 目的

ターミナルを使わない人が、ボタンだけで次を終えられるようにする。

1. 何をするアプリかを知る(安全境界を含む)
2. AI をつなぐ — **Continue with ChatGPT**(自分の ChatGPT プラン)、または入っていれば Claude Code / Codex を検出
3. Google をつなぐ — 当面は利用者自身の OAuth クライアント(手順を画面で案内)
4. 自分の設定(呼び名・署名・対象アカウント)を入れる
5. 毎日のワークフローを定期実行に登録する
6. 閲覧アプリ(きょう / 選考 / 企業…)を開く

## 変えないこと(非目標)

- **すべてローカル。** katazuku 側のサーバは作らない。利用者の ChatGPT / Google のトークンを中継・保管するホスト型の仕組みは作らない
  (ChatGPT プランのホスト型利用は OpenAI の別手続きが必要。Google も公開クライアントには審査が必要)。
- **無料・オープンソース(Apache-2.0)。** 有料機能・テレメトリ・広告を入れない。
- **安全境界はコアのまま。** アプリは既存の `scripts/workflow.ts` と `src/` を呼ぶだけで、送信・提出の能力を増やさない。
- claude.ai のログインは実装しない(Anthropic の方針)。

## 技術の選択: Electron

| 観点 | Electron | Tauri |
|---|---|---|
| 既存コードの再利用 | メインプロセスが Node。`src/`(node:sqlite・設定・Sign in with ChatGPT のループバック)とワークフローをそのまま呼べる | 本体は Rust。既存の Node コードを動かすには Node をサイドカーとして同梱する必要がある |
| 貢献のしやすさ | TypeScript / JavaScript だけで完結(今の貢献者層と同じ) | Rust のツールチェーンが要る |
| 配布サイズ | 大きい(100MB 前後) | 小さい |
| セキュリティ | contextIsolation・sandbox・preload の最小API・CSP を自分で固める必要がある | 既定が堅め |

katazuku はコアが Node で、CLI の起動・node:sqlite・ループバックOAuthを Node で持っているため、**Electron を選ぶ**。
サイズの不利は、就活期間だけ使うデスクトップアプリとしては許容できると判断した。
将来、コアが単体バイナリ化できたら Tauri への移行を再検討する。

## 構成

```
desktop/
  package.json        独立したパッケージ(ルートの依存ゼロ方針に影響させない)
  main.mjs            メインプロセス: 窓・IPC・固定コマンドの実行
  preload.cjs         contextBridge で最小のAPIだけを画面へ渡す
  renderer/index.html 初回ウィザード(6ステップ)
  renderer/wizard.js
  renderer/style.css
```

- 画面(renderer)は `nodeIntegration: false` / `contextIsolation: true` / `sandbox: true`。外部URLは読み込まず、
  リンクは既定のブラウザで開く。CSP は `default-src 'self'`。
- IPC は「状態を読む」「決まったコマンドを実行する」だけ。任意のコマンド文字列を画面から受け取らない。
- 設定は `katazuku.config.json`(スキーマ `schemas/katazuku-config.schema.json` で検証)へ書く。
- AI の接続:
  - ChatGPT: `scripts/chatgpt.ts signin` と同じ処理(127.0.0.1 のループバック・PKCE・ID トークン検証)。
    画面には「Continue with ChatGPT」ボタン、初回だけ「ChatGPT プランを使っています」の案内、「使用量を管理」の案内を出す
    (OpenAI の UI/UX ガイドライン)。
  - Claude Code / Codex: PATH 上の CLI を検出して案内するだけ。ログインは各 CLI の画面で本人が行う。
- 定期実行: Windows はタスクスケジューラ(`scripts/register-tasks.ps1`)、macOS は launchd、Linux は systemd --user。
  登録内容を画面に表示し、本人がボタンを押したときだけ登録する。

## Google 接続の課題

- いまは利用者が自分の Google Cloud で OAuth クライアントを作る必要があり、ここが最大の離脱点。
- 誰でも使える「公開」クライアントにするには Google の OAuth 検証が必要で、Gmail の読み取りは制限付きスコープのため
  第三者のセキュリティ評価も求められる。ローカル動作のままこれを満たす方法(配布物にクライアントIDを同梱し、
  トークンは各PCに保存)を別途検討する。それまでは画面で手順を案内する。

## ChatGPT プランだけで全部を回すための課題

ChatGPT プラン(Sign in with ChatGPT)の推論は、いまはツールなしの工程(毎朝の選考同期の抽出など)だけに使っている。
メール見張り・朝のまとめも ChatGPT プランだけで回すには、Gmail・カレンダーの操作を katazuku 側の関数(ツール)として
Responses API へ渡す実装が要る。公式の制約(ツールは名前空間でまとめるか additional_tools で渡す)に沿って別PRで作る。

## 残っていること(この骨組みの先)

1. ウィザードの各ステップを実処理につなぐ(骨組みでは状態表示と固定コマンドの起動まで)
2. パッケージング(electron-builder 等)・Windows / macOS のコード署名・更新の配布(自動更新は既定オフ)
3. 配布物での実行経路の確定(骨組みはリポジトリの tsx を使う。Electron 44.5.0 同梱の Node 24.21 で `node:sqlite` が読み込めることは確認済み)
4. ChatGPT プランのツール利用(上記)
5. Google の公開クライアント化の検討(上記)
6. アクセシビリティ(キーボード操作・読み上げ)と、Apple 風の操作感(個人向けアプリのため)の仕上げ
