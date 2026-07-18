# Spec 10: 面接から人・基本情報を自動更新するパイプライン ※構想(段階実装)

> 【方針 2026-07-18】面接を重ねるほど、**人(people)と個人マスタの基本情報(特に長所短所・キャリア軸・
> 志望動機の素材)が自動で育つ**状態にする。面接録音→議事録パイプライン(`scripts/interview-digest.ps1`
> + `interview-digest-prompt.md`)は既に「面接官情報」と「自己分析素材」を毎回生成している。それを
> people/profile のマスタへ橋渡しする。関連: [[project-interview-recording]] spec07(people)・spec08(data)・spec09(insight)。

## 2層で考える

### ① 抽出(PC側 = 完全自動にできる)
`interview-digest` の後段に、各面接から次を抽出・更新する処理を足す:
- **面接官 → 人マスタ**: 会った人(氏名/会社/役割/notes/followUp)を `people` の import 形式で追記・更新
  (既存の堅牢インポート `mergePeople` = name+company で名寄せ・非破壊マージ・顔は後入れ、をそのまま活かす)。
- **自己分析の差分 → 基本情報**: 面接FBやノートから、`strengths`/`weaknesses`/`careerAxis`/`desiredRole`/
  `desiredIndustry` 等の**更新候補**を抽出し、profile の basic import 形式で用意(値の入ったフィールドだけ上書きマージ)。
  ※氏名・住所・生年月日等の確定情報は面接では変わらないので対象外。変わるのは"自己PR系"だけ。
- 生成物は `Downloads/katazuku-people-import.json` / `katazuku-profile-basic.json` を**自動再生成**(常に最新)。
- 一次情報(`chrome-prompts/interview-notes.local.md`・`logs/interviews/`)を正とし、マスタはそこから再生成できる形にする。

### ② 反映(ブラウザ側 = 現構成の制約)
データは本人ブラウザの localStorage にあり PC側から直接書けない。ゆえに:
- **セミ自動(現構成で可)**: 面接後に最新 import が用意される → 本人が1クリックでインポート
  (or 朝のルーチン `daily-sync`/`asa` が生成を回す)。「たまにインポートを押すだけで常に最新」。
- **完全自動(ゼロクリック)**: バックエンド(DB+認証)が前提(spec: backend 採用時)。DBへ書き込み→アプリが読む。
  → 完全自動が欲しくなったら backend 移行とセットで実装する。

## 実装ステップ(段階)
1. `interview-digest-prompt.md` に「面接官→people import」「自己分析差分→profile import」の生成ステップを追加。
2. マスタ再生成スクリプト(`scripts/build-people-import.mjs` 等)を用意し、notes/logs から import を組み立て。
3. `asa`/`daily-sync` に「新しい面接があれば import 再生成」を組み込み(セミ自動)。
4. (将来)backend 導入時に、import ではなく DB 直書き＝完全自動へ切替。

## 注意
- 個人情報・第三者情報は localStorage/ローカルのみ、リポジトリに入れない(既存方針どおり)。
- 自動抽出は**推測で確定情報を上書きしない**。自己PR系の"候補"を足す/更新するに留め、確定項目(氏名・住所等)は触らない。
- 顔写真は面接では取れない場合が多い(公開情報 or 将来の録画スクショから別途)。
