# 公式デザインコンポーネント

デジタル庁デザインシステム v2.18.0の公式HTML/CSSを `shared/src/dads` に無改変で同梱しています。採用元のcommitとファイル一覧は `SOURCE.json`、ライセンスは `LICENSE` を参照してください。

共通シェルの再読込ボタンは公式outline/md（48px）、本文スキップリンクとフォーカスは黒4px・黄色の補助に対応しています。公式のリセットは既存レイアウトより先に、コンポーネントは後に適用します。8つの閲覧画面は `shared/src/viewer-components.tsx` で公式ボタン・セレクト・タブのDOMとclassへ接続します。カード、状況ラベル、画面配置は製品固有の補助部品です。

新しいUIでは公式のDOM構造とclassを利用してください。本文16px、補助文字14px以上、常時ラベル、必須表示、エラーと対象入力の関連付け、キーボード操作も合わせて実装します。色だけを似せる対応で完了としません。

SmartHR UIへの依存は閲覧画面から除去しました。公式CSSの同梱ファイルは変更していません。ボードのタブは左右矢印・Home/Endで切り替わり、対応するパネルを `aria-controls` と `aria-labelledby` で結びます。架空データで8画面のビルド、ボードと面接準備の表示、390pxと320pxの画面幅を確認しています。

ここでいう対応は採用した公式部品と確認した画面の範囲です。JIS X 8341-3への適合や全ブラウザ・支援技術での試験完了を主張するものではありません。

公式仕様: https://design.digital.go.jp/dads/
配布元: https://github.com/digital-go-jp/design-system-example-components-html
