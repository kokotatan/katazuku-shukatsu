# ブラウザ操作計画の安全契約

`src/browser-plan.ts`は、Agentが作った自由な指示をそのままブラウザへ渡さず、決定論的な操作計画へ制限する公開契約です。
これは実サイトを自動操作するadapterではありません。サイト固有adapterは、利用規約と画面を確認したうえで、この契約を実装します。

## できる操作

- 許可済みHTTPS originとpath prefix内への`navigate`
- 非機密selectorに対する`assert`、`fill`、`click`、`wait`
- 本人操作へ引き渡す`checkpoint`
- 計画の最後に1回だけ置ける`commit`

`evaluate`、任意JavaScript、query/fragment付きURL、別origin、path逸脱、password/token/cookie等の欄・参照は受け付けません。
入力値は計画へ埋め込まず、本人が承認したaction内の非機密scalarをJSON Pointerで参照します。

## dry-run

`runBrowserPlan({ plan, mode: 'dry-run' })`は計画を厳格検証し、plan hash、action hash、step種別、URLのpath、selectorの短いhashだけを返します。
承認値と生selectorはsummaryへ出さず、`BrowserDriver`は一度も呼びません。

## executeの前提

`mode: 'execute'`では、次をすべて満たす場合だけDriverを順番どおり呼びます。

1. 計画の`actionHash`と、凍結コピーした承認済みactionのhashが一致する。
2. Executorが受け取った本人承認hashも同じである。
3. DBの論理identityが計画と一致し、roleが`canonical`である。
4. 外部冪等キーが固定されている。
5. 直前の外部状態再照合が`not_done`である。

再照合が`done`ならDriverを呼ばず完了済みとして扱います。`unknown`なら停止します。Driverの例外や成否不明も自動再試行せず、`needsReconcile: true`を返します。
MFA、CAPTCHA、本人確認、規約同意、認証は`checkpoint`で本人へ引き渡します。

## adapter実装時の条件

- `BrowserDriver`はExecutor process内に置き、一般MCP toolへ直接公開しない。
- Driverへ渡された`approvedValue`をログ、例外、スクリーンショット名へ保存しない。
- 画面変更を検知したら曖昧に続行せず`needs_user`または`unknown`を返す。
- commit後に成功証拠を再取得し、同じ外部冪等キーでreconcileできるようにする。
- 実企業のURL、HTML、Cookie、応募内容、検査問題を公開fixtureへ入れない。

回帰試験は`npm run test:browser-plan`で実行できます。
