# katazuku-shukatsuのネクタイロゴ

2026-09-08に本人が青一色のv4への差し替えを承認。

- 元資料: 以前作成した `katazuku-logo-golden-ratio-v4.png`。
- 配信用マスター: `necktie-master.png`。組版画像からネクタイ単体をimage_genで抽出した書き出し用画像。元画像そのもののピクセル切り抜きではない。
- 白背景。マークの高さは正方形の約68%。PWAのmaskable用途でも端を切らない余白を設ける。
- 配信用サイズは `powershell -File tools/gen-brand-icons.ps1` で作成。図形を変更せず縮小する。
- ホーム、7アプリの共通ナビ、board、各ページのfavicon、PWA、通知に適用。
- 本番デプロイはこの差し替え作業では実施していない。
- 2026-09-08本人指示により、UIの主色は画像から採った青 `#005AFD`、リンクは `#004BD6` に統一。制作表記は `Kotaro Design Lab.`。基本部品はSmartHRを使い、色はロゴに合わせる。

## 最終プロンプト

組み込みimage_genツールを使用。CLIやAPIキーは使用していない。

```text
Create a clean production export of the EXISTING approved logo. Extract ONLY the vivid blue necktie mark at the upper left of this reference, keeping exactly the silhouette proportions and shape (separate trapezoidal knot, broad tapered tie blade, narrow curved tail flowing left). It is not a new design. Center that isolated blue tie on an absolutely uniform PURE WHITE (#ffffff) square canvas. The mark is 68% of the total square height, centered horizontally and vertically so it has generous safety margins for app icons. No words or letters, no checkerboard, no texture, no outlines, no icon container shape, no grey, no shadow or gradients. Single flat blue symbol only on solid white.
```

透明背景の初回出力は実際にはRGBの市松模様付きだったため不採用。白背景の出力を採用した。
