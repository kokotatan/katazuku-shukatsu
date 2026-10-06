# 公式デザインコンポーネント

デジタル庁デザインシステム v2.18.0の公式HTML/CSSを `shared/src/dads` に無改変で同梱しています。採用元のcommitとファイル一覧は `SOURCE.json`、ライセンスは `LICENSE` を参照してください。

共通シェルの再読込ボタンは公式outline/md（48px）、本文スキップリンクとフォーカスは黒4px・黄色の補助に対応しています。公式のリセットは既存レイアウトより先に、コンポーネントは後に適用します。

新しいUIでは公式のDOM構造とclassを利用してください。本文16px、補助文字14px以上、常時ラベル、必須表示、エラーと対象入力の関連付け、キーボード操作も合わせて実装します。色だけを似せる対応で完了としません。

この移植の範囲は公式コンポーネント基盤と共通シェルです。既存の個別画面にはSmartHR部品が残っています。OSS全画面のDADS移行完了やJIS適合を主張するものではありません。

公式仕様: https://design.digital.go.jp/dads/
配布元: https://github.com/digital-go-jp/design-system-example-components-html
