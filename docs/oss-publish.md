# OSS公開パイプライン(private ↔ OSS を安全に往復させる)

最終更新: 2026-08-14

ホーム直下で兄弟配置した private(`katazuku-shukatsu-private`)と OSS(`katazuku-shukatsu-oss`)を使い、private の中核を公開リポジトリ
`kokotatan/katazuku-shukatsu` へ安全に反映し、逆に OSS 側の改善を private に落とすための仕組み。
「private を育てれば OSS が育つ」「OSS の貢献が private に戻る」を、個人データを漏らさず成立させる。

## 3つの部品

1. **遮断スキャナ** `tools/scan-secrets.mjs`(OSS リポジトリに同梱・公開)
   個人情報・秘密情報を「PIIの形」で検出する。スクリプト自体には実名を書かない。
   固有名詞(実在の企業名・人名)の遮断は、外部ファイル `SCAN_BLOCKLIST` で渡す。
2. **遮断リスト** `scripts/oss/blocklist.txt`(**private 限定・OSS へは絶対に出さない**)
   実名・実社名・実IDを1行1語で列挙。publish.ps1 がスキャナに渡す。
3. **CIゲート** `.github/workflows/ci.yml`(OSS 側)
   push/PR ごとに `scan + test` を実行。形ベースの漏洩と壊れたテストを常時止める。

## いま使える手順(片方向: private → OSS)

```powershell
pwsh scripts/oss/publish.ps1          # scan + test のゲートだけ回す(push しない)
pwsh scripts/oss/publish.ps1 -Push    # ゲート通過時のみ OSS へ push
```

公開する中核の編集は兄弟フォルダ `C:\Users\okuya\katazuku-shukatsu-oss` 側で行い、上のゲートを通して push する。

## リポジトリ配置

Private と OSS は入れ子にせず、ホーム直下の兄弟フォルダとして管理する。

```text
C:\Users\okuya\
├── katazuku-shukatsu-private\
└── katazuku-shukatsu-oss\
```

- 2つは別のGit履歴・別のリモートとして扱う。nested repository、subtree、worktreeにはしない。
- 個人レイヤー(実データ・prompt・scripts・config)はPrivateだけに置き、OSSにはコピーしない。
- OSSへpushする前に必ずPrivate側の `scripts/oss/publish.ps1` を通す。
- `scripts/oss/blocklist.txt` はpublish時にOSSへコピーしない(スキャナは外部参照で使うだけ)。

## 分界(何を出す・出さない)

台帳は [oss-extract-manifest.md](./oss-extract-manifest.md)。要点:

- 出す: DBスキーマ・セマンティックレイヤー・状態機械・冪等化・schema・匿名の1例・汎用テスト
- 出さない: 実データ、氏名・企業・面接記録、シートID、鍵・合言葉、個人prompt、INFRA台帳
