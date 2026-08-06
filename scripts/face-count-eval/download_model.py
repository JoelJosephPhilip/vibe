"""
One-time download of the MediaPipe Face Detector task model (#1222).

The model binary isn't committed to the repo (same convention as
frontend/public/models for the browser-side TF.js models - see root
.gitignore). Run this once before `eval.py`.
"""

import os
import urllib.request

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite"
MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "blaze_face_short_range.tflite")


def main():
    os.makedirs(os.path.dirname(MODEL_PATH), exist_ok=True)
    if os.path.exists(MODEL_PATH):
        print(f"Already present: {MODEL_PATH}")
        return
    print(f"Downloading {MODEL_URL} ...")
    urllib.request.urlretrieve(MODEL_URL, MODEL_PATH)
    print(f"Saved to {MODEL_PATH}")


if __name__ == "__main__":
    main()
