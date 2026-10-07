"""faster-whisper で1本の音声(モノラル)を文字起こしし、発話ごとの時刻つきJSONを標準出力へ出す。

任意導入の文字起こし方式。voicebox が無い環境で使う。呼び出し元は scripts/transcribe.ts
(npm run transcribe -- <録音> --backend faster-whisper)で、ここを直接叩く必要はない。

    pip install faster-whisper
    python scripts/faster-whisper-transcribe.py <音声.wav> [--model large-v3-turbo] [--language ja]

出力は最終行に1つのJSON: {"segments": [{"start": 秒, "end": 秒, "text": "..."}]}
進捗は標準エラーへ出す。録音はローカルで処理し、外部へは送らない
(初回だけモデルの重みを取得する。取得済みなら通信しない)。

既定値の理由:
- large-v3-turbo / CPU int8: GPU が無いノートPCでも1時間の面談を現実的な時間で処理できる
- vad_filter=True: 無音区間での定型句の幻聴(「ご視聴ありがとうございました」等)を減らす
- condition_on_previous_text=False: 1度の誤認識が後続の発話へ連鎖して同じ文を繰り返すのを防ぐ
- beam_size=1: 精度の差が小さく、CPUでの速度が大きく上がる
"""

import argparse
import json
import os
import sys


def main() -> int:
    parser = argparse.ArgumentParser(description="faster-whisper で音声を文字起こしする")
    parser.add_argument("audio")
    parser.add_argument("--model", default=os.environ.get("KATAZUKU_WHISPER_MODEL", "large-v3-turbo"))
    parser.add_argument("--language", default="ja")
    parser.add_argument("--device", default=os.environ.get("KATAZUKU_WHISPER_DEVICE", "cpu"))
    parser.add_argument("--compute-type", default=os.environ.get("KATAZUKU_WHISPER_COMPUTE_TYPE", "int8"))
    parser.add_argument("--beam-size", type=int, default=1)
    args = parser.parse_args()

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper が入っていません: pip install faster-whisper", file=sys.stderr)
        return 3

    model = WhisperModel(args.model, device=args.device, compute_type=args.compute_type)
    segments, info = model.transcribe(
        args.audio,
        language=args.language,
        vad_filter=True,
        condition_on_previous_text=False,
        beam_size=args.beam_size,
    )
    out = []
    for segment in segments:
        text = segment.text.strip()
        if text:
            out.append({"start": round(segment.start, 2), "end": round(segment.end, 2), "text": text})
        print(f"{segment.end:8.1f}s / {info.duration:.1f}s", file=sys.stderr)
    # Windows の既定コードページで日本語が化けないよう、ASCII に逃がして出す
    print(json.dumps({"segments": out}, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
