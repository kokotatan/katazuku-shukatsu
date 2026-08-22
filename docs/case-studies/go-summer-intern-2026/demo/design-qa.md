# Design QA — 共同配車コントロールタワー

## Comparison target

- Source visual truth: `public/assets/selected-control-tower-reference.png`
- Browser-rendered implementation: `qa/live-screen.png`
- Side-by-side full-view evidence: `qa/source-vs-live.png`
- State: 関東ライブ管制、先頭の共同配送候補を選択した初期状態
- Browser viewport: 1440 × 1024 CSS px
- Source pixels: 1487 × 1058
- Implementation pixels: 1440 × 1024
- Device scale factor: 1
- Density normalization: ほぼ同一の16:11デスクトップ比率。比較ボードで両画像を同じ表示幅に正規化した。

## Findings

P0 / P1 / P2 の修正必須項目はありません。

- Fonts and typography: 日本語UIは Yu Gothic UI / Meiryo 系で統一。見出し、本文、補助情報の比率とウェイトは参照案の高密度な業務画面に一致し、折返し・切れ・過密表示なし。
- Spacing and layout rhythm: 左ナビ、候補一覧、地図、選択詳細の4領域を維持。主地図を最大面積にし、候補と承認アクションの視線移動も参照案と同じ。12px前後の角丸、薄い罫線、最小限の影で統一。
- Colors and tokens: 白・クールグレー・黒を基調に、青／シアンを主要状態、アンバーを要確認、緑を成功に限定。ボタンと本文のコントラストを確保。
- Image quality and asset fidelity: 地図は専用生成した 1254 × 1254 の高解像度ラスターを使用し、拡大時にもルートと車両マーカーが鮮明。画像代替の手描きSVGやCSSアートなし。
- Copy and content: 30社、602台、1,254件、共同配送率68%など、プロダクト固有の日本語データに統一。プレースホルダー英語なし。
- Icons: Phosphorアイコンに統一し、20px前後・同一線幅で配置。主要操作のラベルを併記。
- Accessibility: セマンティックなbutton/input、検索placeholder、地図と構成図のalt、キーボードフォーカス表示を実装。
- Viewport resilience: 1440 × 1024で比較。1280 × 800でも横スクロールなし（body scroll width = client width = 1265px）を確認。

## Focused-region evidence

追加の切り出し比較は不要と判断。ソースと実装がほぼ同一ピクセル寸法で、候補一覧・地図・詳細パネルのテキストと余白をフルビュー画像上で読めたため。詳細パネルの候補切替と承認モーダルはブラウザ上で個別に操作確認した。

## Interaction verification

- 共同配送候補を東京A/B社から埼玉C/D社へ切替え、詳細見出しが更新されることを確認。
- 「統合案を確認」→確認モーダル→「承認依頼を送る」→成功通知を確認。
- 「配送計画」→「最適化を実行」→積載率82%・制約適合→「共同配送便を確定」を確認。
- 「例外対応」→到着遅延+24分→「振替案を承認」→振替手配済みを確認。
- 「システム構成」画像が 1672 × 941 で読み込み完了することを確認。
- ブラウザconsoleの warning / error: 0件。

## Comparison history

- Initial comparison: P0 / P1 / P2なし。参照案の主要領域・階層・操作導線を維持。
- P3 follow-up: 参照案の地図には都県名があるが、実装の専用地図はルート可読性を優先して地名を省略。操作理解への影響はなく、将来実地図APIへ置換する際の改善候補。

## Final result

final result: passed
