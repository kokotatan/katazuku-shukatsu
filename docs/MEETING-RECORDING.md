# オンライン面談の録音(Windows)

面談を「相手の声つき」で録り、あとから文字起こし・議事録化できる形で残すためのスクリプト。
`scripts/record-vac.ps1` と、同時に走るスクリーンショット撮影 `scripts/capture-meeting-shots.ps1` の2本。

これは**任意の追加機能**で、本体(`src/`)からは独立している。Windows 専用。

## 前提

- Windows + Windows PowerShell 5.1(または PowerShell 7)
- `ffmpeg` が PATH にあること。winget の `Gyan.FFmpeg` で入れた場合は PATH に無くても自動で拾う
- `virtual-audio-capturer`(screen-capture-recorder に同梱の DirectShow フィルタ)
  - 入っていなくても内蔵マイクだけで録音は続行するが、**相手の声は入らない**
- 予定が `data/katazuku.db` の `appointment` に入っていること(開始時刻の補完に使う)

導入できているかは、デバイスが2つとも見えるかで確認する:

```powershell
ffmpeg -list_devices true -f dshow -i dummy
```

`"virtual-audio-capturer" (audio)` と、内蔵マイク(日本語版Windowsなら `"マイク配列 (...)"`、
英語版なら `"Microphone Array"`)が並んでいれば準備完了。

## 使い方

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\record-vac.ps1 `
    -AppointmentId 42 -EndIso 2026-08-14T19:30:00+09:00 -Slug acme-1st
```

- `-StartIso` を渡すと、開始 `-LeadMinutes`(既定5分)前まで待ってから録り始める
- `-StartIso` を省略すると `-AppointmentId` を手がかりに DB から開始時刻を引く。
  引けたときだけ待機し、引けなければ即座に録音を開始する
- 録音は「予定の終了時刻 + `-BufferMinutes`(既定15分)」で自動停止する
- 内蔵マイクの名前が既定と違う環境では `-MicPattern` を上書きする

出力は `logs/interviews/` の下に、録音 `<スラッグ>-<日時>.wav`(16kHz mono)と
スクリーンショット `<スラッグ>-<日時>-shots/` が**同じ語幹**で並ぶ。この対応は規約なので崩さないこと。
`logs/` は `.gitignore` 済み。録音・文字起こし・顔写真は個人情報であり、コミットしてはいけない。

## なぜこの構成なのか

ヘッドセットやイヤホンを使うと、内蔵マイクだけを掴む録音では**相手の声が一切入らない**。
かといって Windows の Game Bar は、実測でどちらの使い方も破綻した:

| Game Bar の当て方 | 結果 |
|---|---|
| 会議ウィンドウに当てる | 相手の声は録れるが2〜8分ごとに分割され、まとまった時間が欠落する |
| 別の安定したウィンドウに当てる | 連続して録れるが、**録画対象アプリの音しか拾わない**ため相手の声が入らない |

「切れない設定」にすると声を失う。そこで DirectShow の2系統を `amix` で1本にまとめる:

- `virtual-audio-capturer` = **既定の再生デバイスのループバック**(= 相手の声)
- 内蔵マイク = 自分の声

ループバックを使うので、出力先がヘッドセットでも Bluetooth でも相手の声が録れる。
Realtek の「ステレオ ミキサー」は Realtek 出力しか映さないため代用にならない。

目安: 無音 -91dB / 相手が話している間 -25〜-30dB。16kHz mono で1分あたり約1.9MB。

**出力デバイスは録音開始前に確定させ、途中で変えないこと。**
`virtual-audio-capturer` は開始時の既定デバイスに張り付く。

## Windows PowerShell 固有の罠(踏み抜き済み)

このスクリプトの見た目の複雑さはほぼここに由来する。消さないこと。

### 1. `Out-String` は既定でコンソール幅に折り返す

`ffmpeg -list_devices` の出力からデバイスの `Alternative name "@device_..."` を正規表現で拾うが、
`Out-String` は**ホストのコンソール幅**で折り返す。タスクスケジューラ経由の非対話ホストでは80桁なので、
80桁を超える `@device_...` が途中で改行され、`Alternative name "([^"]+)"` が閉じ引用符を
見つけられず不一致になる。

結果は「デバイスが無い」という誤判定で、**録音が丸ごと起動しない**。
しかも対話シェルから手で叩くと窓が広くて再現しないため、自動実行のときだけ壊れる。
`Out-String -Width 4096` を必ず付ける。

### 2. デバイス名が cp932 で復号されて文字化けする

ffmpeg はデバイス名を UTF-8 で出すが、Windows PowerShell 5.1 は既定で端末コードページ
(日本語環境は cp932)で復号する。「マイク配列 (...)」が化けて名前の一致判定に引っかからず、
内蔵マイクを取り逃す。スクリプト冒頭で `[Console]::OutputEncoding` を UTF-8 に固定する。

**このスクリプトを別プロセスとして起動する側でも同じ設定が要る。**
呼び出し元だけ直しても、子プロセスは既定のコードページに戻る。

### 3. ネイティブ exe の stderr は `$ErrorActionPreference = 'Stop'` を巻き込む

`ffmpeg ... 2>&1` の stderr は ErrorRecord になり、EAP=Stop のままだと `NativeCommandError` に
化けてスクリプトごと止まる。デバイス列挙と DB 参照の区間だけ `Continue` に落としている。

### 4. `Start-Process -ArgumentList` は空白で引数を割る

出力パスやスクリプト引数に空白が入ると分割されて壊れる。埋め込んだ `"` も落ちる。
渡す値は空白なし(ISO の `T` つなぎ、空白を除去したスラッグ)に統一している。

### 5. `[datetime]::Parse` の `Kind`

オフセットの無い `"2026-08-14T19:27:45"` は `Kind=Unspecified` になり、
そこへ `.ToLocalTime()` を呼ぶと「UTCだった」とみなされて時差ぶん足される。
1分のはずの録音長が541分と算出されたことがある。オフセット付きのときだけ変換する。

### 6. 日本語を含む `.ps1` は UTF-8 BOM で保存する

BOM が無いと Windows PowerShell 5.1 が UTF-8 を ANSI と誤読する。
行末が2バイト文字だと改行を食って次の行を飲み込むため、
「変数が空になる」「構文エラー」といった無関係な形で表面化する。

## 含まれないもの

- **スケジューラ連携**: 予定を見て自動で録り始める常駐の仕組みは本リポジトリには入っていない。
  `record-vac.ps1` は単発の実行単位なので、タスクスケジューラや cron から予定ごとに叩く
- **文字起こし・議事録化**: 録音ファイルの受け取り手は各自の環境に委ねている
