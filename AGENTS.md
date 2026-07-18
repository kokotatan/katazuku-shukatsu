# katazuku — エージェント引き継ぎ(codex / Claude 共通)

就活生・奥山彪太郎さん(ユーザーは本人1人)の就活を自動運転する個人プロジェクト。
目的: ルーチン・雑務を自動運転し、本人は「考える・受ける・認証する・決める」だけに集中する。
返答・コメント・コミットは日本語。絵文字禁止。

## アーキテクチャ(2026-07-18 DB中心化。docs/specs/08-data.md)

```
data/katazuku.db(正本・SQLite/node:sqlite・gitignore) ──→ Googleシート(一方向ミラー・スマホ/PC俯瞰)
        ↑                                             ──→ board/(管理画面。ミラーのシートを読むだけ)
  agent(唯一の書き手): メール→ sync/scripts/db-apply.ts / DB→ db-mirror.ts → MCPでシートへ
```

- **DBへの入力は6本(2026-07-18本人定義)**: ①メール(daily-sync/mail-watch) ②会話(本人→agent)
  ③面接の録画・録音(interview-digest) ④提出結果(submit系エージェント) ⑤カレンダー ⑥調査結果(企業研究)。
  現在①②のみ接続済み。③〜⑥を順次DB直結にするのが自動運転の残り工事
- **書き手はagentのみ**。人はシートを直接編集しない(ミラーで消える)。人の修正依頼は会話でagentが受けてDBに書く
- ステータス更新は `sync/src/db.ts` の `transition()` に集約(終了系は根拠があれば確定・終了からの復活なし・
  手書きの詳細ステータスを粗い進行中で潰さない・「辞退予定」は内定通知でも上書きしない)
- 名寄せ `sameCompany`: NFKC正規化・部分一致は両方4文字以上のみ(トヨタ⊂トヨタ・コニック・プロ誤マージ対策)
- シート(ID 1jf6kSy7tZqakw8QocOmMzU6WToncQVQCeIuQ1VfRjMM)のタブ「選考管理（新）」「企業マスタ（新）」がミラー先。
  「活動ログ」タブと logs/activity-log.jsonl に、自律処理は「何を/何のために/どうしたか」を必ず1行残す
  (scripts/log-activity.ps1)

## テスト(変更したら必ず全部通す)

```
cd sync && npx tsx scripts/check-db.ts     # DB遷移規則・apply・mirror(39項目)
cd sync && npx tsx scripts/check-sheet.ts  # 旧シート書込エンジン(41項目・移行完了まで残す)
npm run build                              # board(管理画面)ビルド + sync全チェック
```

## 進行中のタスク(2026-07-18時点)

1. **【方針確定 2026-07-18 18:48 本人】アプリ群は残す(復活済み)**: シートは見えにくいので人間用UIはアプリ群。
   廃止は「各アプリがlocalStorageを正として持つこと」だけ。次の改修=各アプリを「ミラーのシートを読む窓」化
   (board/src/lib/data.ts の読み取り方式を共通ライブラリ化して各アプリへ)。
   **見た目はSmartHR Design Systemのまま維持**(本人が気に入っている。刷新はしない。細部改善のみ可)。
   api/ のみ廃止のまま(履歴はタグ apps-archive-20260718)
2. **daily-syncの実走確認**: scripts/daily-sync-prompt.md の新フロー(抽出→db-apply→db-mirror→MCP書込)を初回実行で確認
3. **board/の実機確認**: katazuku.kotalabo.com にデプロイ後、スマホでOAuth→表示確認
4. **次の構想**: 企業研究・面接対策パイプライン(deep research・IR・ブログ/動画・OBOG・業務/顧客/技術理解を
   企業ごとのdossierに集約し、DBと面接準備に接続する)。着手前に本人と設計を確認する
5. **【DB完成後・本人事前承認済み(2026-07-18)・指示不要で実施】人脈/基本情報/顔をDBへ載せ、面接から自動更新**:
   - people(面接官)・個人マスタの基本情報・面接官の顔写真を DB に投入し、`board/` から見えるようにする(spec07/08/10)。
   - 面接録音→議事録(interview-digest)から、面接官→people と、自己PR系(strengths/weaknesses/careerAxis/
     desiredRole/desiredIndustry)を **DBへ自動更新**。氏名・住所等の確定情報は上書きしない(候補追加のみ)。
   - **シード(移行の種)**: 面接官11名・基本情報一式・顔3枚(川島=JAFCO/関根=LayerX/富士元=リンク・アイ)は
     `Downloads/katazuku-people-import.json`・`katazuku-profile-basic.json` と、`logs/interviews/`・
     `chrome-prompts/submit.local.md` から再生成可能。証明写真は Bash `cp` で `katazuku-files` から取得可。
   - 顔取得ロジック: 公開情報(公式チームページ/Wantedly本人)から `curl`+`ffmpeg`で256px化→本人確認(名前+会社+経歴一致)。
   - 今後の面接で顔を自動取得したいなら、会議ウィンドウのスクショsamplerを `record-audio` 系に追加。

6. **トラック重複の整理(daily-sync初回実走 2026-07-18 で判明)**: position照合が厳格すぎて、
   エクサウィザーズ/八洲電機/LayerX/日本トレカセンター/PKSHA に既存と同じ話の別トラックが追加された。
   samePositionの緩和(包含許容)+既存トラックへの統合ツール(db-merge-tracks)を作って重複を畳む

## 禁止・注意

- `credentials/`・`.env`・service-account.json・`data/`・`logs/`・`*.local.md` はコミットしない(gitignore済)
- 選考ステータスを機械的に上書きする変更を入れない(必ず transition() 経由)
- 選考メール・ES の事実は chrome-prompts/submit.local.md(台帳)が正。勝手に事実を創作しない
- Webテスト・コーディングテストの代行受験は不可(本人受験)
- デザイン: SmartHR Design System 準拠(smarthr-ui / Tailwindトークン / system-ui。詳細はCLAUDE.md)
