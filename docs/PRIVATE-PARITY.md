# private版との機能・安全境界の追随

この文書は、OSS版をprivate版の縮小デモにしないための追随台帳である。追随とはソースをそのまま複製することではなく、個人情報・資格情報・企業別URLを除いた再利用可能な契約、状態機械、安全境界、回帰試験をOSSへ実装することを指す。

確認日: 2026-10-31

## 追随済み

| 領域 | OSSでの実装 | 検証 |
|---|---|---|
| 正本DBと6入力 | メール、会話、面談記録、提出結果、Calendar、調査結果を専用writerで反映 | `test:core`、`test:write-layer`、`test:workflows` |
| 選考・提出・予定 | 状態遷移、名寄せ、提出物分解、Calendar同期鮮度、`available/conflict/unknown` | `test:core`、`test:mobility`、`test:workflows` |
| 応募安全境界 | 本人承認、Web適性検査の代行禁止、冪等な応募run、外部結果の再照合 | `test:application` |
| 面談運用 | 録音対象判定、meeting run、文字起こし、構造化議事録、人物・プロフィール候補、準備ready判定 | `test:recording`、`test:meeting-run`、`test:transcription`、`test:interview-autopilot` |
| provider非依存実行 | Codex、Claude、API、ローカルモデル、失敗分類、利用枠復帰、checkpointと安全なfailover | `test:agent-runtime` |
| 宣言的workflow | Agentは構造化提案だけ、Executorが決定論的副作用を担当。正本identity、工程順、capability、承認hashを固定 | `test:workflow-control` |
| 第三者メール | 元メッセージ、宛先、本文、日程、送信元、providerを固定。Sent不明時は`unknown`で再送禁止 | `test:third-party-email` |
| 第三者フォーム | 候補日時とhostを固定し、本人承認後だけ外部冪等キー付きで提出 | `workflows/third-party-form.json`、`test:workflow-control` |
| 採用ポータル連絡 | 企業別hostを設定値として分離し、本人承認後だけ送信、外部IDと証拠参照を監査 | `workflows/third-party-portal-message.json`、`test:workflow-control` |
| MCP | `read/write/sensitive/actions`、型付きtool、任意SQL・shell・秘密値・ローカルpathの非公開 | `test:mcp` |
| Muse remote接続 | OAuth 2.1 gateway、端末relay、scopeとtool allowlist、秘密値・payload非永続化。全4 scopeを実bridgeと合成DBへ往復し、失効、production設定、公開endpoint、incident復旧を別gate化 | `test:muse-gateway`、`test:mcp`、`muse:production-preflight`、`muse:live-verify` |
| Museメール証跡契約 | 対象メールボックスに対応するMuse connectorが実在する場合だけ、Secure VM内認証、毎回承認、action hash、送信ID、Sent再照合を要求。iCloud対応自体は実機証拠待ち | `test:mcp`、`test:third-party-email` |
| ローカルiCloudメール | credential brokerを別processで呼ぶIMAP/SMTP adapter。TLS固定、秘密値非出力、unknown再送禁止 | `test:icloud-mail` |
| ローカル認証ブローカー | Windows DPAPI CurrentUser、隔離Chrome、origin＋テナントパス二重検査、欄type再検査、MFA/CAPTCHA/規約同意停止、設定世代分離。個人URL・暗号文・profileは端末内だけ | `test:local-login`（CLI、設定、DPAPI、合成Chrome） |
| ブラウザ操作計画 | 許可origin/path、非機密JSON Pointer、無副作用dry-run、正本identity、承認hash、外部冪等キー、事前reconcile、最後のcommit 1回を型とExecutorで強制。任意JavaScript、秘密欄、成否不明の再試行を拒否 | `test:browser-plan`（36件の合成Driver検査） |
| ハーネス改善 | 最小観測、合成回帰case、baseline/candidate eval、安全gate、人手承認、revision競合防止、直前版rollback | `test:harness-improvement` |
| snapshotと閲覧面 | 機密を分離したsnapshot、ローカルviewer、Cloudflareへの明示push | `test:snapshot-viewer`、`cloudflare:check` |

`workflows/daily-sync.json`と`daily-sync-local.json`は、private版と同じ`prepare → extract → validate → apply → snapshot → audit`契約を公開する。取得先を特定のメールproviderへ固定せず、remote connectorは`mail.read`、取得済み入力は`workspace.read`に分離した。

## 意図的に公開しないもの

- 本人の氏名、住所、電話、送信元アドレス、選考履歴、メール本文、面談記録、顔写真
- Apple/Google/Museのtoken、app-specific password、credential brokerのsecret ID
- 端末名、SSH先、OS keychainのrecord、実データDB、run log、snapshot
- 実企業の採用portal URL、専用browser profile、規約確認前の企業別自動操作adapter
- private版だけで使う運用上の緊急復旧処理や個人用シートmirror

これらは機能不足ではなくsecret/private adapter境界である。公開契約はprovider・host・accountを設定値として受け取り、実値と認証は利用者の端末またはMuse Secure VMに残す。

## まだ実環境の証拠が必要な項目

次はコード未実装ではなく、外部アカウントまたはproduction環境での接続証拠が未取得である。証拠なしに「接続済み」「送信済み」「審査済み」とは扱わない。

1. Muse Connector Platformへのproduction gateway deploy、提出、審査、利用者アカウントでの接続（preflight・secret-free live verifier・提出tool specは実装済み）
2. 利用者のMuseアカウントにおけるiCloud対応可否。対応する場合は実ログイン、実メール読取、毎回承認、Sent再照合
3. public privacy noticeのproduction deploy
4. 各採用portalの規約確認と、共通`BrowserDriver`契約を実装する許可済みadapterの実サイト回帰fixture
5. macOS/Linuxの定期実行とOS keychainの実機確認

## 追随を壊さない基準

private版の新機能をOSSへ移すときは、次の順で判断する。

1. 個人値と認証を除いた業務契約を抽出する。
2. Agentの判断とExecutorの副作用を分離する。
3. 正本identity、source ref、action hash、外部冪等キー、`unknown`を型へ入れる。
4. 合成fixtureで成功、拒否、重複、成否不明、再開を検証する。
5. private adapterは公開契約を実装し、資格情報をMCP・ログ・Skillへ返さない。

完全一致の指標はファイル名ではなく、同じ入力と同じ安全条件に対して、同じ許可・停止・再開判断を行えることである。
