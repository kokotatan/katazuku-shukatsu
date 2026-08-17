# OSS公開パイプライン(private ↔ OSS を安全に往復させる)

最終更新: 2026-08-14

private(`katazuku-shukatsu-private`)の中核を、公開リポジトリ
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

中核の編集は OSS クローン(`.oss-checkout/`)側で行い、上のゲートを通して push する。

## 双方向にする(推奨: git subtree)

OSS リポジトリを private の中に `oss/` プレフィックスの subtree として抱えると、
両方向の同期が git の標準操作になる。

```powershell
# 一度だけ: OSS を private の oss/ として取り込む(private のツリーがクリーンなときに)
git remote add oss https://github.com/kokotatan/katazuku-shukatsu.git
git subtree add   --prefix oss oss main --squash

# private で育てた中核(oss/ 配下)を OSS へ上げる … ただし publish.ps1 のゲートを先に通す
git subtree push  --prefix oss oss main

# OSS 側の改善・PR を private に落とす
git subtree pull  --prefix oss oss main --squash
```

- 個人レイヤー(実データ・prompt・scripts・config)は `oss/` の外に置く。ここは OSS に絶対行かない。
- `git subtree push` の前に必ず `scripts/oss/publish.ps1`(scan + test)を通すこと。
  取り込み忘れの個人データを subtree が素通しさせないための堰。
- `oss/blocklist.txt` は publish 時に OSS へコピーしない(スキャナは外部参照で使うだけ)。

## 分界(何を出す・出さない)

台帳は [oss-extract-manifest.md](./oss-extract-manifest.md)。要点:

- 出す: DBスキーマ・セマンティックレイヤー・状態機械・冪等化・schema・匿名の1例・汎用テスト
- 出さない: 実データ、氏名・企業・面接記録、シートID、鍵・合言葉、個人prompt、INFRA台帳
