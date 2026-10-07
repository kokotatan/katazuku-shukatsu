# 面談の文字起こしと議事録化

面談の録音から、文字起こし → 議事録(人が読むMarkdown + DB反映用JSON) → 正本DBへの反映、までを行う。
録音そのものは [MEETING-RECORDING.md](./MEETING-RECORDING.md)、録音機と正本DBの機械が別のときの運び方は
[INTERVIEW-BUNDLE.md](./INTERVIEW-BUNDLE.md)。

これは**任意の追加機能**で、使わなくても本体は動く。録音・文字起こし・議事録は個人情報なので、
出力は既定で gitignore 済みの `logs/interviews/` に置く。コミットしないこと。

## 流れ

```
録音(wav / mp3 / m4a / flac / mp4 など)
   │  npm run transcribe            ← 文字起こしだけ(エージェントもDBも使わない)
   ▼
<名前>-transcript.txt
   │  npm run interview:digest      ← 読み取り専用のエージェントが議事録の厳格JSONを返す(ツールなし)
   ▼
<名前>-minutes.md(人が読む議事録) + <名前>-db.json(DB反映用)
   │  --apply(同じ機械に正本DB)  /  scripts\new-interview-bundle.ps1(別の機械へ運ぶ)
   ▼
正本DB(interview_note・人物・人物メモ・プロフィール候補。予定の会議実行は done)
```

- 文字起こしはスクリプトが決定的に行い、LLMのツール呼び出しには任せない。provider によっては非対話の実行で
  MCPツールの呼び出しを自動で拒否するため、議事録化の provider を切り替えたときに文字起こしごと止まるのを避ける
- 議事録化のエージェントには文字起こしをプロンプトに埋め込んで渡し、ツールは何も渡さない。
  返ってきたJSONは Schema(`schemas/interview-minutes.schema.json`)と必須項目で検査してから書き出す
- runId・予定ID・支援面談ID・文字起こしのパスは実行側が決め、モデルには出させない

## 1. 文字起こしだけをする

```sh
npm run transcribe -- logs/interviews/example.wav
npm run transcribe -- logs/interviews/example.wav --backend faster-whisper --speakers
```

| オプション | 意味 |
|---|---|
| `--backend auto\|voicebox\|faster-whisper` | 方式(既定 `auto`。下の「方式の選び方」) |
| `--speakers` | ステレオ録音を左右別に文字起こしし、`[相手]` / `[本人]` を付ける(faster-whisper のみ) |
| `--out <txt>` | 出力先(既定 `logs/interviews/<元の名前>-transcript.txt`) |
| `--force` | 同じ録音の文字起こしがあっても作り直す |
| `--keep-work` | 分割した音声などの中間ファイルを残す(既定では成否にかかわらず消す) |

同じ録音・同じ方式の文字起こしが既にあれば、作り直さずに再利用する(`<出力>.source.json` に元ファイルのサイズと更新時刻を記録している)。

前提として `ffmpeg` が要る(Windows: `winget install Gyan.FFmpeg` / macOS: `brew install ffmpeg`)。
PATH に無ければ `KATAZUKU_FFMPEG` で場所を指定する。

### 出力の形

voicebox は30秒ごとの見出し形式になる。無音の区間も消さずに1行残す(時刻の対応を崩さないため)。

```
[00:00]
本日はよろしくお願いします。人事の面接官Aです。

[00:30] [無音]
[01:00]
学生時代に力を入れたことを教えてください。
```

faster-whisper は発話ごとの形式になる。`--speakers` を付けると話者ラベルが付く。

```
[00:00] [相手] 本日はよろしくお願いします。
[00:03] [相手] 人事の面接官Aです。
[00:07] [本人] よろしくお願いします。
```

## 方式の選び方

| | voicebox | faster-whisper |
|---|---|---|
| 導入 | Voicebox のアプリ(ローカルで動き、MCPで `voicebox.transcribe` を出すもの) | Python と `pip install faster-whisper` |
| 呼び方 | MCP(streamable HTTP)。既定 `http://127.0.0.1:17493/mcp` | `scripts/faster-whisper-transcribe.py` を子プロセスで |
| 時刻 | 30秒単位 | 発話単位 |
| 話者分離 | できない(モノラルに混ぜて渡す) | ステレオ録音なら `--speakers` でできる |

`auto` は「すぐ使えるもの」を優先する: 起動済みの voicebox → faster-whisper → voicebox を起動して待つ。
`--backend` で明示したときは、その方式が使えなければ理由を出して止まり、黙って別の方式へ切り替えない。

### voicebox の注意

- **1回の要求で先頭30秒しか文字起こししない。** しかも全体の長さを返すので、長い録音をそのまま渡すと
  冒頭30秒だけの文字起こしがエラーなしで返る。このため録音を30秒ごとに分割して順に渡している
- 止まっていれば起動してから使う。冷えた状態からは本体 → サーバ → ワーカーの順に立ち上がり、
  ポートが開くまで90秒前後かかるため、**最大240秒**待つ。起動コマンドは `KATAZUKU_VOICEBOX_COMMAND`
  (Windows の既定のインストール先 `Program Files\Voicebox\voicebox.exe` は自動で探す)
- 接続先を変えるなら `KATAZUKU_VOICEBOX_MCP_URL`
- 各チャンクは3回まで再試行する。それでも失敗したら全体を失敗にする(一部が欠けた文字起こしを残さない)

### faster-whisper(任意)

```sh
pip install faster-whisper
npm run transcribe -- logs/interviews/example.wav --backend faster-whisper
```

既定は `large-v3-turbo` を CPU の int8 で動かし、`vad_filter=True`(無音での定型句の幻聴を減らす)、
`condition_on_previous_text=False`(誤認識が後続へ連鎖して同じ文を繰り返すのを防ぐ)、`beam_size=1`、日本語。
GPU のないノートPCでも1時間の面談を現実的な時間で処理できる設定にしている。

| 環境変数 | 既定 |
|---|---|
| `KATAZUKU_PYTHON` | Windows は `python`、それ以外は `python3` |
| `KATAZUKU_WHISPER_MODEL` | `large-v3-turbo` |
| `KATAZUKU_WHISPER_DEVICE` | `cpu`(GPU なら `cuda`) |
| `KATAZUKU_WHISPER_COMPUTE_TYPE` | `int8` |

初回だけモデルの重みを取得する。取得済みなら通信しない。録音そのものは外部へ送らない。
この方式はリポジトリの `scripts/faster-whisper-transcribe.py` を呼ぶので、リポジトリを clone して使う(npm パッケージ単体には含まれない)。

### 話者分離(`--speakers`)

`scripts/record-vac.ps1 -Stereo` で録ると、相手の声(再生デバイスのループバック)が左、自分の声(マイク)が右に入る。
`--speakers` はこの左右を別々に文字起こしし、時刻順に合流させる。話者が音響的に確定するので、
議事録化で「本人が言っていないことを本人の発言にする」誤りが起きにくい。
モノラルの録音に `--speakers` を付けると、チャンネル数を確かめて止まる。

## 2. 議事録にする

```sh
# 予定に結び付いた選考面接(予定IDは npm run quick などで確認)
npm run interview:digest -- logs/interviews/example.wav --appointment 42 --company 会社A
# 支援面談(就活エージェント・イベント運営者など)
npm run interview:digest -- logs/interviews/example-transcript.txt --career-meeting 7 --organization 支援組織A
# 何を渡すかだけ確かめる(文字起こしもエージェントも動かさない)
npm run interview:digest -- logs/interviews/example.wav --appointment 42 --dry-run
```

録音を渡せば先に文字起こしをする(`--backend` と `--speakers` は上と同じ)。`.txt` / `.md` を渡せば文字起こしを省く。

| オプション | 意味 |
|---|---|
| `--appointment <ID>` / `--career-meeting <ID>` | 結び付ける予定 / 支援面談。同時には指定できない |
| `--company` / `--organization` / `--position` | 分かっている値。モデルの推定より優先する |
| `--occurred-at <ISO>` | 面談の開始時刻。無ければ元ファイル名や更新時刻からモデルが推定する |
| `--agent auto\|claude\|codex\|...` | provider(既定は設定ファイルの順。[AI-PROVIDERS.md](./AI-PROVIDERS.md)) |
| `--out-dir <dir>` | 出力先(既定は文字起こしと同じ場所) |
| `--apply [--db <path>]` | この機械の正本DBへ反映する |

出力は2つ。

- `<名前>-minutes.md`: 人が読む議事録。位置づけ・面談者・得た情報・聞かれたこと・ネクストアクション・
  「今後への示唆」(志望動機への反映点・次選考の対策・フォローアップ・懸念・自己分析への追記の提案)・要確認の箇所
- `<名前>-db.json`: `src/db-apply-interview.ts` の `InterviewInput` の形

runId は予定IDがあれば `meeting-<ID>`、支援面談なら `career-meeting-<ID>`、どちらも無ければ元ファイル名から作る。
同じ runId の議事録は何度反映しても1件のまま(2回目は `"created": false`)。

プロンプトは `scripts/interview-digest-prompt.md`。文字起こしの読み方(幻聴の扱い、話者ラベルの信頼度、
話者が不明な発言を本人の回答にしないこと)と、出力するJSONの形をここで決めている。

## 3. 正本DBへ反映する

- 同じ機械に正本DBがあるなら `--apply` を付ける。予定の会議実行(`meeting_run`)は `done` になる
- 正本DBが別の機械なら、面談バンドルにして運ぶ([INTERVIEW-BUNDLE.md](./INTERVIEW-BUNDLE.md))

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\new-interview-bundle.ps1 `
    -DbJsonPath logs\interviews\example-db.json `
    -TranscriptPath logs\interviews\example-transcript.txt `
    -AudioPath logs\interviews\example.wav `
    -OutputZipPath example-bundle.zip
```

## 4. 顔写真を付ける(任意)

`scripts/record-vac.ps1` は録音中に `<録音>-shots/shot-NNN.png`(プライマリ画面のスクリーンショット)を撮る。
ここから面談相手の顔を切り出し、議事録JSONの `people[].photoPath` に付ける。議事録化のエージェントは画像を見ない
(ツールなし)ので、切り出しはスクリプトが決定的に行い、**どの顔が誰かは本人が書く**。顔の見た目から人物を当てる工程は無い。

```sh
# 1. 顔を切り出す(<録音>-shots/face-NNN.png と faces.json ができる)
npm run interview:faces -- detect logs/interviews/example.wav
# 2. faces.json の "person" に、議事録JSONの people[].name を書く(または --map で渡す)
npm run interview:faces -- attach logs/interviews/example-db.json --map face-001=面接官A
# 3. 正本DBへ登録する(反映済みの議事録でも、顔写真だけが追加される)
npm run interview:faces -- attach logs/interviews/example-db.json --apply
```

| `detect` のオプション | 意味 |
|---|---|
| (なし) | 任意導入の検出器 `scripts/detect-faces.py`(OpenCV)で顔の矩形を探す |
| `--box <スクショ>:x,y,w,h[:表示名]` | 検出器を使わず、顔の範囲を自分で指定する(複数可) |
| `--detections <json>` | 別の検出器の結果(`{ "shots": [{ "file", "width", "height", "faces": [{ "x", "y", "w", "h", "score", "label" }] }] }`)を使う |
| `--self-name <表示名>` | 本人の表示名(複数可)。設定の `profile.displayName` と環境変数 `KATAZUKU_MEETING_DISPLAY_NAMES`(カンマ区切り)にも足せる |
| `--labels` | 検出器が pytesseract で顔の下の表示名を読む(読めた顔だけ本人の判定に使う) |
| `--min-size <px>` / `--margin <割合>` | 使う顔の最小の大きさ(既定 48) / 顔の周りに足す余白(既定 0.3) |
| `--force` | `faces.json` があっても作り直す(同じ顔に書いた "person" は引き継ぐ) |

切り出しの規則(`src/face-crop.ts`):

- 小さすぎる顔(サムネイルや資料の写真)は使わない
- タイルの表示名が本人の表示名と一致した顔は、**同じ位置に写る顔ごと**外す(表示名が読めなかったスクショの本人も拾わないため)。
  表示名が読めない・設定していないときは本人の顔も候補に残るので、`attach` で本人の名前を書いても写真は付かない
- 同じ位置に何度も写る顔はスクショをまたいで1人とみなし、いちばん大きく写った1枚だけを切り出す。番号は画面の上から順

`attach` は、書かれた対応のうち曖昧でないものだけを使う。次の場合は写真を付けずに `[要確認]` として理由を表示する。

- 誰の顔か未記入 / 議事録の `people` にいない名前 / 同じ名前の人物が議事録に複数いる
- 1人に複数の顔が当たっている / 本人の名前が書かれている / 別の写真が既に指定されている

検出器は任意で、使うなら `pip install opencv-python`。既定は OpenCV 同梱の Haar cascade(追加の取得・通信なし)。
`KATAZUKU_FACE_MODEL` に YuNet の onnx を指定するとそちらを使う(モデルは各自で入手する)。
画像はローカルで処理し、外部へは送らない。顔写真・スクショ・`faces.json` は `logs/` 配下(gitignore 済み)にだけ置き、
正本DBへは `data/private/photos` への複製と `person_photo.storage_key` だけが入る(DB・スナップショット・git に画像は入らない)。
既に写真がある人物は上書きしない。正本DBが別の機械なら、`-shots` フォルダごと面談バンドルに入れて運ぶ(`photoPath` は同名の同梱ファイルへ付け替えられる)。

## 5. 録音が終わったら自動で議事録にする(任意)

`npm run interview:autopilot` は定期実行の1回分で、`logs/interviews` から録り終わった録音を見つけて議事録にする。

```sh
npm run interview:autopilot -- --apply --dry-run   # 何を処理するかだけ表示する(何も書かない)
npm run interview:autopilot -- --apply             # 正本DBがこの機械にある
npm run interview:autopilot -- --bundle            # 正本DBが別の機械にある(面談バンドルを作る。PowerShell が要る)
npm run interview:autopilot                        # 議事録とDB反映用JSONを作るだけ
```

1回の実行で、録り終わった録音を古い順に最大 `--max` 件(既定1)処理する。

1. `npm run interview:digest -- <録音>`。`scripts/record-vac.ps1` が録音の隣に書く `<録音>.recording.json` から、
   予定ID(`--appointment`)と開始時刻(`--occurred-at`)を渡す
2. `<録音>-shots` があれば `npm run interview:faces -- detect` で顔写真の候補を切り出す(検出器が無ければ飛ばす)。
   誰の顔かは本人が書くまで付けない。書いたら `npm run interview:faces -- attach <録音>-db.json --apply`
3. `--bundle` なら `scripts/new-interview-bundle.ps1` で `logs/interview-bundles/<録音>-bundle.zip` を作る

録り終わりは次のどれかで判断し、どの場合もファイルが1分以上伸びていないことを確かめてから処理する。

- `<録音>.stop` がある(手で止めたとき、空のファイルを置けばすぐ対象になる)
- `<録音>.recording.json` の録音プロセスが居ない、または自動停止の時刻(`stopAfterIso`)を過ぎた
- どちらも無い録音は、15分以上伸びていない

| 仕組み | 置き場所 |
|---|---|
| 二重起動の防止(固まった前回は6時間で回収) | `logs/interview-autopilot.lock` |
| 処理済みの記録(録音の大きさと更新時刻。同じ録音は二度と処理しない) | `logs/interview-autopilot-state.json` |
| 経過のログ | `logs/interview-autopilot.log` |
| 結果 / 失敗 | `logs/activity-log.jsonl` / `logs/alert-interview-autopilot.txt` |

200KB 未満の録音(ほぼ無音)は議事録化しない。失敗した録音は30分おいて試し直し、3回続けて失敗したら止まる
(直してから `logs/interview-autopilot-state.json` のその録音の行を消すと、また対象になる)。

### 定期実行に登録する

Windows はタスクスケジューラへ登録する(管理者権限は要らない。ログオン中だけ動く)。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts
egister-interview-autopilot.ps1 -DryRun   # 登録内容だけ表示
powershell -NoProfile -ExecutionPolicy Bypass -File scripts
egister-interview-autopilot.ps1           # 10分ごと・--apply
powershell -NoProfile -ExecutionPolicy Bypass -File scripts
egister-interview-autopilot.ps1 -Mode bundle
powershell -NoProfile -ExecutionPolicy Bypass -File scripts
egister-interview-autopilot.ps1 -Unregister
```

macOS / Linux は cron か launchd から同じコマンドを叩く。録音の仕組み(`record-vac.ps1`)は Windows 専用なので、
他のOSでは録音ファイルを `logs/interviews` に置き、録り終わったら `<録音>.stop` を置くか15分待つ。

```cron
*/10 * * * * cd /path/to/katazuku-shukatsu && npm run interview:autopilot -- --apply >> logs/interview-autopilot.cron.log 2>&1
```

launchd なら `npm run schedule:print -- launchd` が出す plist([WORKFLOWS.md](./WORKFLOWS.md))と同じ形で、
`ProgramArguments` を `npm run interview:autopilot -- --apply`、`StartInterval` を 600 にしたものを `~/Library/LaunchAgents` に置く。
katazuku はスケジューラへ勝手に書き込まない(登録は各自が行う)。

## 含まれないもの

- **顔と人物の自動の対応づけ**: 顔の見た目や話者から誰かを推測しない。対応は本人が `faces.json` か `--map` で書く
- **人物の氏名表記のWeb検索**: 面談内容を外部へ送らないため行わない。表記が不確かな人物は `notes` に「要確認」と残る
- **処理後の録音の自動削除**: 根拠音声の保管・削除の方針は環境ごとに違うので各自に委ねる
