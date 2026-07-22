# Spec 13: ローカル資格情報ブローカー

最終更新: 2026-07-19

## 目的

企業マイページのログインで、画面構造を判断するモデルやブラウザエージェントへ
ログインID・パスワードの文字列を渡さず、OSに保護された別プロセスだけが入力する。

この仕組みはログインの秘密値入力だけを扱う。会員登録、エントリー、ES提出、辞退、
面接予約などの承認境界は応募自動運転の規則を維持する。

本仕様は本人のPCで動くローカル単一ユーザー版だけを対象とする。SaaS、リモート利用、
複数ユーザー、テナント分離、クラウド資格情報保管は対象外である。

## 信頼境界

~~~text
ローカルモデル
  値を除去したDOM要約から欄番号だけを返す
        ↓
資格情報ブローカー
  portal_id、登録origin、欄typeを再検証
  Windows DPAPIで復号し、入力とログイン操作を同一プロセス内で完了
        ↓
ブラウザ
  MFA・CAPTCHA・origin変更では入力前に停止
~~~

モデル出力の例:

~~~json
{
  "action": "fill_credentials",
  "portal_id": "company_42",
  "username_element": 2,
  "password_element": 3,
  "submit_control": 1
}
~~~

モデルへ渡すDOM要約には、inputのvalue、Cookie、認証ヘッダー、ページ本文全体、
スクリーンショットを含めない。渡せるのはorigin、title、欄番号、tag、type、name、
id、autocomplete、label、placeholder、required、disabledと、送信コントロールの特徴だけである。

## 資格情報の保存

Windows個人版は `CryptProtectData` 相当のDPAPI CurrentUserで暗号化する。
暗号化時の追加エントロピーは、固定バージョン文字列、portal_id、正確なallowed_originから導出する。

暗号化済みであっても資格情報ファイルは機密情報として扱う。

- リポジトリ、DB、snapshot、シート、ログへ入れない
- portal_idごとに別レコードとする
- allowed_originは通常HTTPSのoriginだけを許可する
- 平文をコマンドライン引数、標準出力、例外、活動ログへ出さない
- macOSはKeychain、LinuxはSecret Service等へadapterを交換する

## 実行時の強制規則

ブローカーは次の順で検証する。

1. portal_idに対応する資格情報レコードを読む
2. ブローカー自身が現在タブのoriginを取得し、allowed_originと完全一致を確認する
3. 可視入力欄を再列挙し、ID欄がtext、email、telのいずれか、パスワード欄がpasswordであることを確認する
4. MFAまたはCAPTCHAを検出したら復号前に停止する
5. DPAPIで復号する
6. originと欄typeをもう一度確認する
7. 入力し、許可されたログイン送信コントロールを同じプロセス内で押す
8. 標準出力には成功、停止理由、portal_id、originだけを返す

モデルの指示だけでorigin検証を省略しない。別originへのリダイレクト、欄の曖昧さ、
対象タブが0件または複数件の場合は失敗とする。

## PoC

`scripts/local-login/` に次を置く。

- `lib.mjs`: DOM値除去、ローカルモデル契約、CDP操作、二重検証
- `broker.mjs`: 秘密値を返さない資格情報入力プロセス
- `store-credential.ps1`: 対話入力した秘密値のDPAPI保存
- `unprotect-credential.ps1`: ブローカープロセス専用の復号入口
- `fixture-server.mjs`: 合成資格情報だけを使う偽ログインサイト
- `check.mjs`: 正常系、検索欄誤認、MFA、CAPTCHA、origin不一致、ログ漏えいの回帰確認
- `run-live-poc.mjs`: loopbackだけで起動したllama.cppとQwen GGUFを使う実モデル確認

通常の回帰確認:

~~~powershell
npm run check:local-login
~~~

Qwen GGUF取得後の実モデル確認:

~~~powershell
node scripts/local-login/run-live-poc.mjs
~~~

モデルサーバーは `--offline`、`127.0.0.1` bindで起動する。モデルファイルは
`logs/local-model/` に置き、コミットしない。

## 現在の到達点と実サイト条件

合成サイトではDPAPI保存、値を除去したDOM認識、別プロセス入力、ログイン、MFA・CAPTCHA・
origin不一致停止を確認できる。

ただし現在のCDP PoCは、隔離した試験用Chromeプロファイルだけを対象とする。
普段使っているChromeの既存ログイン状態へ安全に接続するには、次の追加実装が必要である。

- ユーザーが明示的にインストールするChrome拡張
- 拡張IDをallowlistしたNative Messaging host
- 拡張側でも実タブURLを検証する二重originチェック
- 拡張のクリックまたは同等の本人操作をログイン開始の承認とする
- 認証情報を拡張のログ、storage、ページメッセージへ残さない
- サイト別アダプターは欄特徴だけを保存し、秘密値やCookieを保存しない

この境界が実装・レビュー・本人承認されるまで、本物のパスワード入力は本人へ引き継ぐ。
既にログイン済みのChromeで行う非秘密の閲覧・登録フォーム入力はChrome操作手順を使い、
登録確定、規約同意、送信の直前で本人承認を得る。

## OSS配布

公開するのはコード、JSON契約、合成fixture、OS keychain adapterのinterfaceである。
公開しないものは、暗号化済み資格情報、portal_idと実企業の対応表、Cookie、Chromeプロファイル、
実サイトの個人データ入りキャプチャである。

PoCの試験用Chromeだけは、現在のWindows実行環境でGPU subprocessが起動できないため
合成localhostに限定して `--no-sandbox` を使う。本番、外部サイト、普段使いのChromeでは禁止する。

## 検証結果(2026-07-20)

検証エージェントによる再検証。合成テストの再実行、モデル無し経路の確認、
実サイト3プラットフォーム(snar.jp / axol.jp / i-webs.jp)のログインフォーム構造との突合を行った。
実サイトへのログイン試行・本物の資格情報の使用は一切していない(公開ログインページのHTML閲覧のみ)。

### 動く範囲

- `npm run check:local-login` は22項目成功(2026-07-20再実行)。DPAPI保存、値除去DOM要約、
  別プロセス入力、ログイン成功、MFA・CAPTCHA・origin不一致停止、秘密値ログ漏えい無しを再確認した
- この22項目は**モデル無しで通っている**。`check.mjs` は `LOCAL_LOGIN_MODEL_URL` 未設定時に
  `analyzeDeterministically`(セレクタ規則ベース)で判定しており、既定の合成テストは最初からルールベース経路である
- **GGUF取得は実用の前提条件ではない**。`validateModelDecision` はモデルの選択が
  `credentialCandidates`(ルールベース)の一意な候補と完全一致することを要求するため、
  現行設計ではモデルはルールベースを超える判断を一切できない(モデルの判断集合 ⊆ 規則の判断集合)。
  `run-live-poc.mjs` は「モデルが規則と同じ結論を出すか」の冗長確認にすぎない

### 動かない範囲(実サイトとの差分)

実サイト3例の公開ログインページから欄属性のみを転記した要約を `analyzeDeterministically` にかけたところ、
**3例すべてが `credential_fields_not_unique` で停止**した(合成fixtureは通るのに実サイト構造は通らない)。

| サイト | ID欄の実態 | 停止原因 |
| --- | --- | --- |
| snar.jp | `<input type="text" name="id" id="id">`、欄名は `<th>ユーザーID</th>`(label要素でない) | ID欄キーワード不一致。さらに送信が `<a onclick="form.submit()">` で送信コントロール0件 |
| job.axol.jp | `<input type="text" name="id">`、欄名は `<div>ID番号</div>`(label要素でない) | ID欄キーワード不一致 |
| mypage.*.i-webs.jp | `<input type="text" name="gksid" autocomplete="off">`、label要素なし | ID欄キーワード不一致 |

根本原因は2つ。

1. 実サイトは `<label for>` や `autocomplete="username"` を使わず、th・divの近傍テキストで欄名を示す。
   現行のDOM要約はこの近傍テキストを取り込まないため、**要約自体にID欄を特定する信号が入らない**。
   これはモデルを繋いでも解決しない(モデルに渡る情報が同じだから)
2. ヒューリスティックが `name="id"` や `name="gksid"` のような裸の属性名を認識しない

### 実サイトの罠(合成テストとの差分)

- 送信コントロールがaタグ+onclickのサイトがある(snar.jp)。現在の列挙は
  `button, input[type=submit], input[type=button]` のみで拾えない
- axolの送信ラベルは「規約に同意してログイン」。クリック=規約同意であり、spec11の承認境界に触れる。
  この文言の初回は本人承認を得る
- job.axol.jpは**全企業が同一origin**(パスで企業を区別)。origin完全一致だけでは
  別企業のログイン画面に正しい企業の資格情報を入れる誤りを防げない。snar/i-webは企業別サブドメインで安全
- 1ページに複数form(i-webはログイン・照会・新規登録・外部SSOの4form)、ID保存チェックボックス、
  SSOボタン(i-web CONNECT等)が同居する
- `autocomplete="off"`・hidden CSRFトークンは在るが、ページ内入力方式なので影響しない
- 今回閲覧した3ページにCAPTCHAは無かったが、ログイン失敗の繰り返し後に出る可能性は残る
- 現在のCDP接続は隔離した試験用Chrome限定。普段使いのChromeの既存ログイン状態を使うには
  本仕様既述の拡張+Native Messaging境界の実装が必要

### 実用までの残作業(優先順)

1. **欄特定の決定規則の拡張**(モデル不要で3サイトとも解決できる見込み):
   「有効なpassword欄がちょうど1つ、かつ有効なtext/email/tel欄がちょうど1つなら、その組を資格情報欄とする」
   フォールバック規則を追加する。snar・axol・i-webの3構造はいずれもこの条件を満たすことを追試で確認済み。
   併せてDOM要約の `label` に近傍テキスト(同じtr内のth、直前のdt/div等)を取り込む
2. **送信手段の拡張**: 送信コントロール0件のとき `form.requestSubmit()` またはEnterキー送出へ
   フォールバックする(aタグonclick対策)。規約同意を含むラベルは停止して本人承認へ回す
3. **共有origin対策**: 資格情報レコードへ `allowed_path_prefix` を追加し、axol型の同一origin複数企業を区別する
4. **実Chrome接続境界**: 拡張+Native Messaging host(本仕様既述)の実装・レビュー・本人承認。
   これが済むまで本物のパスワード入力は本人へ引き継ぐ運用を維持する
5. (任意)GGUF取得後の `run-live-poc.mjs`: 回帰の冗長確認としてのみ。実用のブロッカーではない

### 本人にしかできないこと

- 初回のパスワード投入(`store-credential.ps1` の対話入力。エージェントは値に触れない)
- MFA・ワンタイムコード・CAPTCHAへの応答(ブローカーは検出したら復号前に停止する)
- 「規約に同意してログイン」型の送信の初回承認
- Chrome拡張のインストールと、拡張経由のログイン開始操作の承認
