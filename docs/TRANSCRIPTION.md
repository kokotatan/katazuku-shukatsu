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

## 含まれないもの

- **面談スクリーンショットからの顔写真の切り出し**: 議事録化のエージェントにはツールを渡さないため、画像を見て切り出す工程は入れていない。
  `people[].photoPath` もモデルには出させない。顔写真を登録するなら、本人が切り出して議事録JSONに足してから反映する
- **人物の氏名表記のWeb検索**: 面談内容を外部へ送らないため行わない。表記が不確かな人物は `notes` に「要確認」と残る
- **自動実行**: 録音が終わったら自動で議事録化する常駐の仕組みは入っていない。タスクスケジューラなどから
  `npm run interview:digest` を叩く
- **処理後の録音の自動削除**: 根拠音声の保管・削除の方針は環境ごとに違うので各自に委ねる
