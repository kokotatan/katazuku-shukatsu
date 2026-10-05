# AIプロバイダ — 自分のAIサブスクリプション / APIキーで動かす

katazuku はAIの利用枠を持っていません。**あなた自身の** Claude / ChatGPT の契約、または API キーで動きます。
katazuku がログイン画面を持つのは、OpenAI がオープンソース・ローカル動作のアプリ向けに手順を公開している
ChatGPT だけです(申し込みフォーム不要。katazuku はトークンを中継するサーバを持たず、あなたのPCの中で完結します)。それ以外は、各社の公式CLIにあなたがログインし、katazuku はその CLI を呼び出すだけです。

## どれを選ぶか

| provider | 支払い | 必要な準備 | ツール(Gmail・カレンダー等) | 向いている工程 |
|---|---|---|---|---|
| `claude-cli`(= `claude`) | あなたの Claude Code の契約・設定どおり | Claude Code を入れて **本人が** ログイン | あり(MCP) | すべて |
| `codex-cli`(= `codex`) | あなたの Codex の契約(`codex login` で ChatGPT アカウント等) | Codex CLI を入れて **本人が** ログイン | あり(MCP) | すべて |
| `codex-oss` | 無料(ローカルモデル) | Ollama / LM Studio | 一部 | 読み物系だけ(`agent.localModelWorkflows`) |
| `anthropic-api` | あなたの Anthropic API キー(従量課金) | `.env` に `ANTHROPIC_API_KEY` | なし | ツール不要の工程(日次同期の抽出など) |
| `openai-api` | あなたの OpenAI API キー(従量課金) | `.env` に `OPENAI_API_KEY` と `KATAZUKU_OPENAI_MODEL` | なし | ツール不要の工程 |
| `chatgpt-siwc` | あなたの ChatGPT プランの使用量 | `npm run chatgpt -- signin`(ブラウザで許可するだけ) | なし(今後対応) | ツール不要の工程 |

順番は `katazuku.config.json` の `agent.providerOrder`(または環境変数 `KATAZUKU_AGENT_ORDER`)で決めます。

```json
{ "agent": { "providerOrder": ["claude-cli", "codex-cli", "chatgpt-siwc", "anthropic-api"] } }
```

- 上から順に試し、**副作用を始める前の失敗**(未ログイン・キー未設定・利用枠切れ・混雑・ツール不足)のときだけ次へ回ります。
- ツールを持たない provider(`*-api` / `chatgpt-siwc`)は、ツールが要る工程(メール見張り・朝のまとめ等)では自動的に飛ばされます。
  日次同期の抽出のように、材料を全部プロンプトへ埋め込む工程でだけ使われます。
- 利用枠切れを検知した provider は、復活予定まで(最長7日)自動で休ませます(`logs/agent-runs/provider-health.local.json`)。

## Claude のサブスクリプションで動かす

1. [Claude Code](https://code.claude.com/docs) を入れ、**あなた自身が** `claude` でログインします。
2. `agent.providerOrder` に `claude-cli` を入れます。

katazuku は `claude -p` を子プロセスとして起動し、プロンプトは標準入力で渡します(引数に入れない)。
claude.ai 側のコネクタは読み込ませず(`ENABLE_CLAUDEAI_MCP_SERVERS=false`)、許可するツールは工程ごとの能力に絞ります。
利用枠・課金はあなたの Claude Code の契約と設定のとおりです。

katazuku は「Sign in with Claude」(claude.ai ログイン)を**実装していません**。
Anthropic は、承認なしに第三者の製品が claude.ai のログインや利用枠を提供することを認めていないためです
([Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview) の注記)。
Claude をAPIで使う場合は `anthropic-api`(あなたのAPIキー)を選んでください。

`anthropic-api` の設定(`.env`):

| 変数 | 意味 |
|---|---|
| `ANTHROPIC_API_KEY` | 必須 |
| `KATAZUKU_ANTHROPIC_MODEL` | 既定 `claude-opus-5-5` |
| `KATAZUKU_ANTHROPIC_EFFORT` | `low` / `medium` / `high` / `xhigh` / `max`(省略時はモデル既定) |
| `KATAZUKU_ANTHROPIC_FALLBACKS` | `0` で、安全分類器による拒否時のサーバ側フォールバックを無効化(既定は有効) |

## ChatGPT / OpenAI で動かす

### Codex CLI(推奨)

1. Codex CLI を入れ、**あなた自身が** `codex login` でログインします(ChatGPT アカウントでのログインを含む)。
2. `agent.providerOrder` に `codex-cli` を入れます。

katazuku はGitのないインストール先や個人データ領域でもCodex CLIを起動します。
Gitリポジトリの検査は省略しますが、読取り専用の工程には`read-only`、書込みを伴う工程には`workspace-write`のsandboxを指定します。
このsandbox指定だけでCLIの全ツールが無効になるわけではありません。ツール不要のAPIプロバイダと同じ制約を保証するものではありません。

### Sign in with ChatGPT(`chatgpt-siwc`)— 開発者でなくても一番かんたん

OpenAI が公開している、**オープンソースでローカル動作するアプリ向け**の手順
([ChatGPT plan usage for open-source apps](https://developers.openai.com/siwc/token-sharing-open-source))に従い、
あなたが許可した ChatGPT プランを katazuku の推論に使います。会話履歴などへのアクセスは含みません。

OpenAI 側の提供はプレビュー段階です(仕様が変わる可能性があります)。止めたいときは `.env` に `KATAZUKU_DISABLE_CHATGPT_SIWC=1`。

```sh
npm run chatgpt -- signin       # ブラウザで「Continue with ChatGPT」→ 許可
npm run chatgpt -- status       # 保存済みアカウントと、プラン利用の可否
npm run chatgpt -- models       # このアカウントで使えるモデル
npm run chatgpt -- use default --model <slug>
npm run chatgpt -- signout      # セッションを失効させ、このPCのトークンを消す
```

実装していること(公式手順どおり):

- 初回は `client_id=dynamic_agent_client` で動的登録し、コールバックで返る**発行済み client_id** を保存して以後の再認可・交換・更新に使う。
  `agent_name_hint=katazuku` は初回だけ送る。
- ホストごとの `ext_agent_host_id`(`urn:uuid:<v4>`)を初回サインイン前に作って保存し、同じホストでは使い続ける。
  資格情報とは別ファイル(`host.json`)なので、別ホストへ資格情報を移してもホストIDは上書きされない。
- 試行ごとに新しい state / nonce / PKCE(S256)。コールバックは `http://127.0.0.1:<port>/auth/callback`(既定1455、使用中なら空きポート)。
  待ち受けを始めてからブラウザを開く。`localhost` は使わない。
- コールバックでは state を先に照合し、`access_denied` なら交換しない。新規登録で client_id が返らなければ未完了、
  再認可で別の client_id が返れば既存の登録を置き換えずに中止。
- コード交換は `authorization_code` + 発行済み client_id + `code_verifier` + 同じ `redirect_uri` + `resource=https://api.openai.com/v1`(シークレット無し)。
  `invalid_grant` はそのコードを捨ててやり直し。
- ID トークンは公開 JWKS(発見文書の `jwks_uri`)で RS256 署名を検証し、issuer・audience(発行済み client_id)・期限・nonce を確認。
  既存アカウントの再サインインでは sub の一致を確認してから置き換える。
- **トークン応答のスコープに `chatgpt.tokens.use.direct` が無ければ、プラン利用は無効として推論しない**
  (API キーなど別の支払い経路を選ぶか、`--enable-plan` で許可し直す)。
- 推論は `POST https://api.openai.com/v1/responses` に `store: false` / `stream: true`、input は配列、非対応の項目
  (temperature・max_output_tokens・metadata・previous_response_id 等)は送らない。`response.completed` を受けたときだけ成功。
- エラーは公式の分類どおりに扱う(`subscription_sharing_usage_limit_exceeded` は利用枠切れとして休止、
  `..._usage_unavailable` は一時的、`..._user_not_eligible` は繰り返さない、開始前の `{"detail":...}` は診断として保存)。
  ChatGPT 側で失敗したときに、katazuku が勝手に別の支払い経路へ切り替えることはありません。
  次の provider へ回るのは、あなたが `providerOrder` にそれを並べた場合だけです。
- 更新は期限の5分前から。発行済み client_id・保存済み refresh_token・`resource` で行い、回転後の refresh_token を
  access_token・期限・スコープと一緒に置き換える。同じセッションの更新はロックで直列化。
  `invalid_grant` / `refresh_token_reused` などはトークンを消して再サインインを求め、通信障害では消さない。
- サインアウトは発見文書の `revocation_endpoint` へ refresh_token の失効を送り(5xx・通信失敗は再試行)、トークンを消す。
  client_id とホストIDの対応は残す。失効を確認できなかった場合はその旨を表示する。
- 資格情報は**リポジトリの外**(既定 `~/.config/katazuku/chatgpt/`、Windows は `%APPDATA%\katazuku\chatgpt\`、
  `KATAZUKU_CHATGPT_DIR` で変更可)に、一時ファイル → rename の原子的な書き込みで、POSIX では `0600` で保存。
  ログ・URL・コミットには載せない。id_token_hint を含む認可URLは画面に出さない。

未実装・要確認(TODO):

- 「使用量を管理」の直リンク: 公式ドキュメントには「ChatGPT の設定 → 使用量(Usage)」とだけあり、URLが載っていないため文言で案内している。
- `force_reconsent=true`: OpenAI が展開を確認するまでは、`--enable-plan` のときだけ既存の `prompt=consent` を使っている。
- OS の資格情報ストア(Keychain / Credential Manager / libsecret)への保存: 依存ゼロ方針のため現状はファイル保存。
- ホストIDは UUID 方式。推奨の JWK thumbprint(RFC 9278)方式は未対応(公式に「UUID も引き続きサポート」)。
- ツールを使う推論(関数呼び出し)は未対応。現状は文章生成だけの工程に限って使う。
- 別マシン(自前のVM)で使う場合: 公式手順どおり、ブラウザのあるPCでサインインし、`accounts/<label>.json` だけを SSH 等で
  VM の同じ場所へ移す。VM では `host.json` を別に作らせる(ホストIDを持ち込まない)。

### OpenAI API キー(`openai-api`)

`.env` に `OPENAI_API_KEY` と `KATAZUKU_OPENAI_MODEL`(アカウントで使えるモデル名。既定値は持たない)を書きます。

## 秘密値の置き場所

- API キーは gitignore 済みの `.env` にだけ置きます(`katazuku.config.json` やコードに書かない)。
- CLI のログイン情報は各 CLI が管理します。katazuku は読みません。
- ChatGPT の資格情報はリポジトリ外の専用ディレクトリに置きます(上記)。
