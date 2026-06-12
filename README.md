# katazuku-shukatsu

就活の実行フェーズを自動化するAIエージェント群のモノレポ。

## なぜ作るか

自己分析もES内容の生成も、すでにカスタムAIで解決できる。残る摩擦は、生成済みの内容をフォームへ入力し、文字数を調整し、コピペするという機械的な実行作業に集約される。katazuku はこの実行フェーズの摩擦をエージェントで消すことだけに焦点を絞る。開発者自身を最初の利用者として設計している。

命名は「片付く」に由来し、各プロダクトは `katazuku <動詞>` 形式で揃える。業務名を後置する構造により、増えても一貫した使用感を保つ。

## プロダクト一覧

| コマンド | 日本語名 | 概要 | インターフェース | 優先度 |
|---|---|---|---|---|
| `katazuku submit` | 書類提出 | ES・書類をフォームへ自動入力して提出 | Claude in Chrome | 第一波 |
| `katazuku test` | 適性検査 | WEB適性検査を受検する、既にプロンプトは用意済み | Claude in Chrome | 第一波 |
| `katazuku inbox` | 連絡管理 | 採用メールの仕分けと返信下書き | バックグラウンド常駐 | 第一波 |
| `katazuku profile` | 個人マスタ | 氏名・学歴・ESデータの一元管理 | スプレッドシート | 土台 |
| `katazuku company` | 企業マスタ | 企業情報・選考ステータスの一元管理 | スプレッドシート | 土台 |
| `katazuku prep` | 直前対策 | 面接前日の準備パックを自動生成 | Claude in Chrome / CLI | 第二波 |
| `katazuku insight` | インテリジェンス | 当日のサマリーと次アクションの提案 | Claude in Chrome / cron | 第二波 |
| `katazuku ask` | ヘルプデスク | 自分のデータへチャットで質問 | チャットUI | 第二波 |
| `katazuku status` | 進捗管理 | 全社の選考状況ダッシュボード | Web UI | 第二波 |
| `katazuku interview` | 面接ログ | 面接録音から構造化メモを生成 | スマホ / CLI | 第三波 |
| `katazuku people` | 人脈整理 | 出会った社員・OBの情報管理 | スマホ / CLI | 第三波 |

実装は優先度順に進める。第一波の submit・test・inbox は、土台である profile・company の2マスタが揃えば動作する。

## プロダクトの分類

インターフェースは業務の性質から決まる。

- **純粋CLI型** — submit・test・prep・insight。コマンド起動でエージェントが裏で動き、結果を返す。追加実装が最も軽い。
- **バックグラウンド常駐型** — inbox。Gmail等と常時接続し、受信を監視する。
- **物理入力型** — interview（録音）と people（手書き入力）。スマホUIを必須とする。
- **共通データ基盤** — profile と company。全プロダクトがこの2マスタを参照する。

## アーキテクチャ

```
Google スプレッドシート（Profile・Company マスタ）
        │  katazuku sync
        ▼
~/.katazuku/data/（ローカルJSONキャッシュ）
        │
        ├─→ Claude in Chrome ショートカット   … submit / test / prep / insight
        └─→ バックグラウンドスクリプト         … inbox / insight
```

| 層 | 実装 |
|---|---|
| データ層 | Google スプレッドシート（人間が編集するマスタ） |
| ランタイムキャッシュ | ローカルJSON（`~/.katazuku/data/`） |
| オーケストレーション層 | Python CLIスクリプト |
| ブラウザ実行層 | Claude in Chrome（Claude Code の `--chrome` 経由で駆動。マルチタブ操作・DOM/ネットワークアクセス・スクリーンショットに対応） |

ブラウザ操作を伴うタスクは Claude in Chrome のショートカット（`/`コマンド、スケジュール実行対応）として、常時監視を要するタスクは常駐スクリプト（n8n / cron）として実装する。

技術スタック: Python, JavaScript/React, n8n, Tailscale, Claude Code, Claude in Chrome。

## リポジトリ構成

以下は想定構成であり、実装の進行に応じて調整する。

```
katazuku-shukatsu/
├── packages/
│   ├── submit/ test/ inbox/ prep/ insight/ ask/ status/ interview/ people/
│   └── core/            # 共通ライブラリ（Profile・Company参照、認証）
├── agents/              # Claude Code / Codex 向けエージェント定義
│   └── submit-agent/ test-agent/ inbox-agent/
├── data/.katazuku/      # ローカルキャッシュ（JSON）
├── scripts/sync.sh      # スプレッドシート → ローカルJSON同期
├── CLAUDE.md            # Claude Code 向けコンテキスト
└── README.md
```

## セットアップ

必要な環境は Node.js 20+、Python 3.11+、Claude Code、Claude in Chrome 拡張機能、Google スプレッドシート（マスタ用）。

```bash
git clone https://github.com/kokotatan/katazuku-shukatsu
cd katazuku-shukatsu
npm install
pip install -r requirements.txt --break-system-packages
```

初期設定では、まず個人マスタをスプレッドシートで作成・入力し、ローカルへ同期したうえで、Claude in Chrome にショートカットを登録する。

```bash
bash scripts/sync.sh                 # マスタをローカルへ同期
# Claude in Chrome に以下を登録
#   /submit → packages/submit/shortcut.md
#   /test   → packages/test/shortcut.md
#   /prep   → packages/prep/shortcut.md
```

## 使い方

```bash
# 書類提出（採用フォームを開いた状態で起動）
/submit

# 適性検査（検査ページを開いた状態で起動）
/test

# 連絡管理（常駐起動）
python packages/inbox/daemon.py
```

submit はフォームを解析し、個人マスタ・企業マスタ・ES素材を参照して入力する。test は適性検査を自動で行い、就活生の時間を捻出する。inbox は採用メールを仕分けし、返信を要するものは下書きを生成して通知する。

## 開発

```bash
cd packages/submit && npm run dev   # 特定パッケージの開発
npm run test                        # テスト
claude                              # Claude Code（CLAUDE.md を自動参照）
```

実装には Claude Code および Codex を用いる。各パッケージの詳細は `packages/<name>/README.md` を参照。

## ライセンス

All rights reserved. 本リポジトリのコードは個人利用を目的として開発されており、許可のない複製・配布・商用利用を禁じる。将来の有料化に際しては、コアエンジンとユーティリティを分割してライセンスを再設計する。

## 作者

[kokotatan](https://github.com/kokotatan)