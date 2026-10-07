# 面談バンドル(録音機 → 正本DB)

面談を録音・議事録化する機械と、正本DB(`data/katazuku.db`)を置いている機械が別のときに、
議事録と根拠ファイルを安全に運んで反映するための仕組み。

正本DBは1台にだけ置く([ARCHITECTURE.md](./ARCHITECTURE.md))。録音機で直接DBを書くと正本が2つに割れるので、
録音機は「反映する材料」を1つの zip にまとめるところまでを担い、DBへの書き込みは正本DBの機械だけが行う。

同じ機械で録音から反映まで済むなら、このバンドルは不要。`src/db-apply-interview.ts` で直接反映すればよい。

## 流れ

```
[録音機]                                   [正本DBの機械]
録音・文字起こし・議事録JSON
   │
   ▼
scripts\new-interview-bundle.ps1  ──zip──▶  npm run interview:apply -- <zip>
 (manifest.json に sha256 を記録)            1. manifest とファイルの sha256 を照合
                                             2. manifest と議事録JSONの runId・予定IDの一致を確認
                                             3. 1トランザクションでDBへ反映(runIdで冪等)
                                             4. 文字起こし・音声を logs/interview-archive/<runId>/ へ保管
```

zip の運び方は問わない。USBメモリ、共有フォルダ、`scp`、クラウドストレージの一時置き場など、
ファイルが1つ届けばよい。中身は sha256 で照合するので、運ぶ途中で欠けたり壊れたりしたものは反映されない。
個人情報の塊なので、運び終えたら途中の置き場からは消すこと。

## 1. 録音機でバンドルを作る(Windows)

議事録JSONは `src/db-apply-interview.ts` の `InterviewInput` の形。`runId` は必須で、
予定の議事録なら `appointmentId`、支援面談なら `careerMeetingId` を入れる。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\new-interview-bundle.ps1 `
    -DbJsonPath logs\interviews\example-db.json `
    -TranscriptPath logs\interviews\example-raw.txt `
    -ShotsDirectory logs\interviews\example-shots `
    -AudioPath logs\interviews\example.wav `
    -OutputZipPath example-bundle.zip
```

- 必須は `-DbJsonPath` だけ。文字起こし・スクショ・音声は、あれば同梱する
- **manifest の `runId` と予定IDは議事録JSONから取る。** 受け側は両者の一致を確かめるので、
  別の値(たとえば議事録を作ったエージェント実行の台帳ID)を manifest に入れると反映は必ず拒否される。
  関数 `New-KatazukuInterviewBundle` に `-RunId` などを明示した場合も、JSONと食い違えば zip を作る前に止まる
- 音声の wav は、`ffmpeg` があれば FLAC へ可逆圧縮して同梱する(1時間で約230MBの wav が概ね半分になる)。
  元の wav は消さない。圧縮しないなら `-NoFlac`
- 録音機が Windows 以外なら、同じ形の zip を自分で作ってもよい(下の「バンドルの形」)

## 2. 正本DBの機械で反映する

```sh
npm run interview:apply -- example-bundle.zip
# DBの場所を明示する場合
npm run interview:apply -- example-bundle.zip --db /path/to/katazuku.db
```

- DBの場所は `--db` > 環境変数 `KATAZUKU_DB` > `<リポジトリ>/data/katazuku.db`
- zip は一時ディレクトリへ展開し、反映後に片付ける。展開には OS の `tar` を使う
  (Windows 10 以降と macOS は zip を読める)。GNU tar しかない Linux では `unzip` で展開して、
  そのディレクトリを渡す(`npm run interview:apply -- ./example-bundle`)
- 同じバンドルを何度反映しても、議事録は1件のまま(2回目は `"created": false`)
- 予定の議事録なら、予定は「完了」、会議実行(`meeting_run`)は `done` になる。支援面談も同様

反映結果は JSON で出る。`warnings` に出たものは反映は続けたが本人が確かめたほうがよいこと。

## 受け側が付け替えるもの

議事録JSONの中のパスは録音機上のもので、正本DBの機械には存在しない。

| 項目 | 扱い |
|---|---|
| `transcriptPath` | 同梱の文字起こしを `logs/interview-archive/<runId>/transcript/` へ写し、そのパスを記録する |
| `people[].photoPath` | 同じファイル名の同梱スクショ(`shots/`)へ付け替え、`data/private/photos/` へ複製する。同梱に無い写真はパスを外して `warnings` に出す(外から届いたJSONの指す任意のファイルを読まない) |
| 音声 | DBには入れず `logs/interview-archive/<runId>/audio/` へ置く |

`logs/` と `data/` は `.gitignore` 済み。録音・文字起こし・顔写真は個人情報なので、コミットしない。

## 拒否されるもの

- manifest の形が違う(`schemaVersion` が1でない、`db-json` がちょうど1件でない など)
- ファイルが欠けている、サイズや sha256 が manifest と違う
- バンドルの外を指すパス(`..`、絶対パス、ドライブ指定)や、途中にリンクを含むパス
- manifest と議事録JSONの `runId` / `appointmentId` / `careerMeetingId` が一致しない
- 議事録JSONの必須項目(`runId`・`occurredAt`・`title`・`summary`、選考なら `company`)が欠けている
- 予定ID・支援面談IDが正本DBに無い

拒否されたときは、DBには何も書かれない。

## バンドルの形

```
manifest.json
interview.json          kind: db-json(ちょうど1件)
transcript/<名前>       kind: transcript(任意)
shots/<名前>            kind: shot(任意・複数可)
audio/<名前>            kind: audio(任意)
```

```json
{
  "schemaVersion": 1,
  "runId": "meeting-42",
  "appointmentId": 42,
  "careerMeetingId": 0,
  "sourceHost": "EXAMPLE-PC",
  "createdAt": "2028-01-10T16:00:00+09:00",
  "files": [
    { "path": "interview.json", "kind": "db-json", "sha256": "<64桁の16進>", "bytes": 268 }
  ]
}
```

検査規則は `src/interview-bundle.ts`、反映は `src/interview-bundle-apply.ts`。

## 会議実行の状態(meeting_run)

録音から反映までの進み具合は、予定ごとに1行の会議実行で追う。

```
armed -> opened -> recording -> stopping -> digesting -> done   (どこからでも failed)
```

```sh
npm run meeting-run -- appointment transition 42 opened
npm run meeting-run -- career transition 7 digesting
```

- 1段ずつしか進めない。2段以上の飛び越しは失敗する
- 既に先の段にいるときに手前の段を指定しても、何もしない(失敗にしない)。
  録音機が正本DBより遅れて `opened` から順に送ってきても、反映が止まらないようにするため
- `done` は終端。議事録の反映は、どの段からでも `done` にする

## 含まれないもの

- 録音機から正本DBの機械への自動転送(SSHの経路づくり・常駐の受け口)。環境ごとに違うので各自に委ねる
- 文字起こし・議事録化そのもの([WORKFLOWS.md](./WORKFLOWS.md) の「未移植のもの」)
