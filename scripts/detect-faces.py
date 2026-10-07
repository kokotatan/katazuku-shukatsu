"""面談スクショから顔の矩形を検出し、JSON で標準出力へ出す(任意導入)。

呼び出し元は scripts/interview-faces.ts(npm run interview:faces -- detect)で、ここを直接叩く必要はない。
切り出し・本人の除外・人物との対応づけは呼び出し側(src/face-crop.ts)が決定的に行い、
この検出器は矩形を返すだけにする。

    pip install opencv-python
    python scripts/detect-faces.py shot-001.png shot-002.png [--labels]

検出器:
- 既定は OpenCV 同梱の Haar cascade(追加の取得なし・通信なし)
- KATAZUKU_FACE_MODEL に YuNet の onnx(face_detection_yunet_*.onnx)を指定すると、そちらを使う。
  横顔や小さい顔に強い。モデルは各自で入手して置く(このスクリプトは取得しない)

--labels を付けると、pytesseract が入っていれば顔の下の帯を OCR してタイルの表示名を label に入れる。
本人のタイルを外すための補助で、読めなくても処理は続く(読めなかった顔は label なし)。

出力は最終行に1つのJSON: {"detector": "...", "shots": [{"file", "width", "height", "faces": [{"x","y","w","h","score","label"?}]}]}
画像はローカルで処理し、外部へは送らない。
"""

import argparse
import json
import os
import sys


def load_image(cv2, np, path):
    # Windows の cv2.imread は非ASCIIのパスを読めないため、バイト列から復号する
    data = np.fromfile(path, dtype=np.uint8)
    return cv2.imdecode(data, cv2.IMREAD_COLOR)


def detect_haar(cv2, image):
    cascade = cv2.CascadeClassifier(os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml"))
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    found = cascade.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=6, minSize=(40, 40))
    return [(int(x), int(y), int(w), int(h), 1.0) for (x, y, w, h) in found]


def detect_yunet(cv2, image, model):
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN.create(model, "", (width, height), 0.8)
    _, faces = detector.detect(image)
    result = []
    for face in faces if faces is not None else []:
        x, y, w, h = [int(round(v)) for v in face[:4]]
        x, y = max(0, x), max(0, y)
        w, h = min(w, width - x), min(h, height - y)
        if w > 0 and h > 0:
            result.append((x, y, w, h, float(face[-1])))
    return result


def read_label(image, box):
    try:
        import pytesseract
    except ImportError:
        return ""
    x, y, w, h = box
    height, width = image.shape[:2]
    top, bottom = min(height, y + h), min(height, y + int(h * 2.5))
    left, right = max(0, x - w), min(width, x + w * 2)
    if bottom - top < 8 or right - left < 8:
        return ""
    try:
        text = pytesseract.image_to_string(image[top:bottom, left:right], lang="jpn+eng")
    except Exception:  # OCR は補助。言語データが無いなどの失敗は label なしで続ける
        return ""
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return lines[0] if lines else ""


def main() -> int:
    parser = argparse.ArgumentParser(description="面談スクショから顔の矩形を検出する")
    parser.add_argument("images", nargs="+")
    parser.add_argument("--labels", action="store_true")
    args = parser.parse_args()
    try:
        import cv2
        import numpy as np
    except ImportError:
        print("opencv-python が入っていません(pip install opencv-python)", file=sys.stderr)
        return 2

    model = os.environ.get("KATAZUKU_FACE_MODEL", "")
    if model and not os.path.isfile(model):
        print(f"KATAZUKU_FACE_MODEL のファイルがありません: {model}", file=sys.stderr)
        return 2
    shots = []
    for path in args.images:
        image = load_image(cv2, np, path)
        if image is None:
            print(f"画像を読めないため飛ばします: {path}", file=sys.stderr)
            continue
        height, width = image.shape[:2]
        boxes = detect_yunet(cv2, image, model) if model else detect_haar(cv2, image)
        faces = []
        for x, y, w, h, score in boxes:
            face = {"x": x, "y": y, "w": w, "h": h, "score": round(score, 4)}
            if args.labels:
                label = read_label(image, (x, y, w, h))
                if label:
                    face["label"] = label
            faces.append(face)
        shots.append({"file": os.path.basename(path), "width": width, "height": height, "faces": faces})
        print(f"{os.path.basename(path)}: {len(faces)}件", file=sys.stderr)
    print(json.dumps({"detector": "yunet" if model else "haar", "shots": shots}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
