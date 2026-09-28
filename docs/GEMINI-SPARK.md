# Gemini Spark 連携(任意)

スマホの [Gemini Spark](https://support.google.com/gemini/answer/17094507) から、企業研究・メール本文の抽出・面談準備・文書や返信の草案を依頼し、
結果を自分の PC 上の katazuku で受け取るための経路です。**使わない人は何も設定しなくて構いません**(未設定ならモデルも通信も呼びません)。

- 正本 DB は**自分の常駐 PC(自宅のミニPC等)に置いたまま**です。クラウドに置くのは OAuth と中継だけで、依頼本文も永続化しません
- 接続できるのは、導入した本人が発行した**接続キー**で同意した Spark アカウントだけです。他人の Spark からは使えません
- Spark から呼べる操作は「依頼の追加・進捗・一覧」の3つだけです。メール送信・予約確定・DB 書き込み・任意コマンドはありません
- 受け取った結果は常に `needs_review`(草案)で止まり、DB への反映は本人が確認してから行います

## 仕組み

```text
スマホ(Spark) ──HTTPS/OAuth──▶ spark-gateway(自分の Cloudflare Worker)
                                       ▲  外向き WebSocket(ポート開放不要)
                                       │
常駐PC:  spark-bridge ──▶ logs/spark-queue.local.db ──▶ spark-worker ──(Chrome)──▶ Spark で実行・結果回収
```

| 部品 | 場所 | 役割 |
| --- | --- | --- |
| `spark-gateway/` | 自分の Cloudflare アカウント | Spark のカスタムアプリ用 MCP エンドポイント(`/mcp`)と OAuth。中継のみ |
| `scripts/spark-bridge.ts` | 常駐PC | gateway へ外向きに接続し、依頼をローカルのキューへ登録する |
| `scripts/spark-queue.ts` | 常駐PC | SQLite の依頼台帳。同じ依頼キーは同じ runId を返し、二重登録しない |
| `scripts/spark-worker.ts` | 常駐PC | Chrome の Spark 画面へ依頼を渡し、完成した結果を検証して受領する |
| `scripts/spark-handoff.ts` | 常駐PC | 依頼文の生成と、返ってきた JSON の検証(手動運用にも使える) |

常駐PC が停止しているあいだは、Spark からの呼び出しに `503`(不在)が返ります。依頼が消えることはありません。

## 必要なもの

- この README の [Requirements](../README.md#requirements) を満たした常駐 PC(タスク登録スクリプトは Windows 用)
- Gemini Spark が使える Google アカウント(カスタムアプリ追加欄の有無は地域・言語で異なるので、実画面で確認してください)
- Cloudflare アカウント(Workers・KV・Durable Objects。無料枠の範囲で動きます)と独自ドメインまたは `workers.dev`
- worker を使う場合: 常駐 PC の Chrome で Spark にログイン済みであること、Claude Code CLI と Claude in Chrome 拡張が使えること

## 導入手順

### 1. gateway を自分の Cloudflare にデプロイする

手順と鍵の扱いは [spark-gateway/README.md](../spark-gateway/README.md) にあります。
終わると次の2つが手元に残ります(どちらも git 管理外)。

- `spark-gateway/owner-key.local.txt` — Spark と接続するときに本人確認で入力する**接続キー**
- `BRIDGE_TOKEN` — 常駐 PC の bridge が gateway へ接続するためのトークン

### 2. 常駐 PC で bridge と worker を動かす

```powershell
# bridge: gateway への常駐接続
# logs/spark-bridge.local.json に {"origin":"https://<gatewayのホスト>","token":"<BRIDGE_TOKEN>"} を保存してから
powershell -File scripts/register-spark-bridge.ps1

# worker: Chrome の Spark へ依頼を渡す(5分間隔)
# logs/spark-worker.local.json に {"enabled":true,"account":"<Sparkで使うGoogleアカウント>"} を保存してから
powershell -File scripts/register-spark-worker.ps1
```

`logs/` は gitignore 済みです。トークンを含むファイルは、読取権限を自分のユーザーだけに絞ってください。
worker はブラウザ操作用のツールだけを許可して起動し、既存の MCP 設定やシェルは読み込みません。
ログイン・MFA・権限追加が必要になった場合は自動では操作せず、その依頼を `blocked` にして止めます。

### 3. Spark に接続する(PC のブラウザで1回だけ)

カスタムアプリの追加は **PC ブラウザの gemini.google.com でしかできません**。スマホの Gemini アプリ・Spark 画面(チャット一覧だけが出る)には追加欄がありません。
PC で一度接続すれば、同じ Google アカウントのスマホからも使えます。

1. PC のブラウザで `https://gemini.google.com/apps`(アプリ連携)を開き、ページ下部の「Spark のカスタムアプリ」欄に `https://<gatewayのホスト>/mcp` を入れて「次へ」
2. Google 側の同意のあと、gateway の同意画面で**接続キー**を入力する
3. スマホの Spark で「katazuku にテスト用の document 依頼を1件入れて、一覧を見せて」などと頼み、常駐 PC のキューに入ることを確認する

```powershell
npm run spark:queue -- list
```

接続キーはパスワードマネージャーなどに保管し、Spark のチャット欄やタスク本文には貼らないでください。
接続をやめるときは Spark 側で連携を解除し、gateway の OAuth grant も失効させます(方法は gateway の README)。

## 依頼できる用途

| kind | Spark に任せる処理 | 受け取ったあと |
| --- | --- | --- |
| `research` | 公式情報からの企業研究 | 出典と内容を確認してから DB へ反映する |
| `daily-sync` | 渡したメール本文からの予定・締切の抽出 | `schemas/daily-sync-result.schema.json` で検証し、元メールと照合してから `db-apply` へ |
| `meeting-prep` | 渡した記録と公開情報から回答案・逆質問を作る | 準備メモとして読む |
| `document` | 要約・比較表・文書の草案 | `summary` / `content` / `sources` / `unknowns` を受け取る |
| `reply-draft` | 宛先・件名・返信本文の案 | 本人が確認してから、自分で送信する |

Spark が使うのは、依頼に含めた資料と公開 Web だけです。Gmail の横断取得、Spark からのメール送信や予約確定、DB への直接書き込みはしません。
メール本文を渡すときは必要な分だけにし、パスワードや `.env` の中身は含めないでください。

## PC だけで使う(スマホ・gateway なし)

```powershell
npm run spark:queue -- enqueue <依頼キー> <kind> logs/spark-input.txt   # 依頼を積む
npm run spark:worker                                                  # 1回処理する
npm run spark -- prepare document logs/spark-input.txt               # 依頼文だけ作り、手で Spark に貼る
npm run spark -- receive <runId> logs/spark-response.json            # Spark の回答を検証して受領する
```

`receive` は runId・依頼 hash・24時間の有効期限・出力 Schema を検証し、合格したときだけ一度だけ受領します。
hash は取り違えや改変を検出するためのもので、Spark 由来であることを証明する署名ではありません。
JSON の形式が正しいことと、内容が正しいことは別です。出典 URL と一次情報は必ず確認してください。

ローカルの MCP サーバーとして使う場合は `npm run spark:mcp`(stdio)または `npm run spark:mcp -- --http` を使います。
HTTP の場合はループバックのみで待ち受け(既定ポート 8797、`KATAZUKU_SPARK_PORT` で変更可)、
32文字以上の `KATAZUKU_SPARK_TOKEN` を Bearer ヘッダーで要求します。

## 依頼の状態と再送

`queued → dispatching → awaiting → polling → needs_review` の順に進みます。

- 送信の途中でクラッシュした依頼は、二重送信を避けるため `blocked` で止まります。
  Spark の履歴で送信済みかどうかを確認し、送信済みなら `npm run spark:queue -- reconcile <runId> <タスクURL>` で回収に戻します
- 結果を取りに行く途中のクラッシュは、同じタスク URL の読み取りだけを再開します
- 依頼の期限は24時間、結果の取得は最大12回までです
- スマホからの再依頼で成否が分からないときは、同じ `requestKey` を使ってください

## 制約

- Spark のタスクを起動する公開 API は確認できていないため、worker は Spark の Web 画面を操作します。UI の変更や利用制限で止まることがあります
- Spark 側での品質とトークン消費は用途ごとに異なり、未計測です。短い単発の依頼は、手元のエージェントで直接処理したほうが軽い場合があります
- 実データでのメール送信・予約の試験は行っていません(その機能は含んでいません)

## テスト

```powershell
npm run test:agent-runtime   # 依頼生成・受領検証・キュー・MCP 転送
npm run test:spark-gateway   # ローカル workerd で OAuth・CSRF・再利用拒否・操作制限・中継・切断
```

## 参考

- [Spark の使い方と提供条件](https://support.google.com/gemini/answer/17094507?hl=en)
- [カスタム MCP アプリ接続の条件](https://support.google.com/gemini/answer/17209137)
- [日本向け提供の案内](https://blog.google/intl/ja-jp/company-news/technology/gemini-spark-comes-to-japan/)
