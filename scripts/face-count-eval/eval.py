"""
Offline face-count detection accuracy evaluation (#1222).

Runs MediaPipe's Python Face Detector task over a labeled frame set and
reports precision/recall/F1 for the NO_FACE and MULTIPLE_FACES proctoring
flags, a 0/1/2+ confusion matrix, and a breakdown by condition_tags.

Runtime note: the production frontend uses @tensorflow-models/face-detection
(MediaPipeFaceDetector via the tfjs runtime, in-browser) which does NOT expose
a per-face confidence score in its public output type (verified against the
installed package version, #1222). This script uses MediaPipe's native Python
Face Detector task instead, which does expose a real per-face confidence via
`detection.categories[0].score` - same underlying MediaPipe face-detection
model family, different wrapper/runtime. This is an intentional, documented
methodological difference: it lets this tool measure genuine
confidence-weighted accuracy even though the browser path currently cannot.
Detection counts from the two runtimes are expected to closely track each
other (same model), but are not guaranteed identical.

(Note: mediapipe's older `mp.solutions.face_detection` API was removed as of
mediapipe 1.0.0 - this uses the current `mediapipe.tasks` API, which requires
the model file downloaded by `download_model.py` below.)

Usage:
    pip install -r requirements.txt
    python download_model.py   # one-time: fetches the .tflite model file
    python eval.py [--labels data/labels.csv] [--frames-dir data/frames] \
                    [--min-confidence 0.5] [--output reports/face-count-eval-results.json]
"""

import argparse
import json
import os
from collections import defaultdict

import cv2
import mediapipe as mp
import pandas as pd
from mediapipe.tasks.python import BaseOptions, vision
from sklearn.metrics import confusion_matrix, precision_recall_fscore_support

BUCKETS = ["0", "1", "2+"]
DEFAULT_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "blaze_face_short_range.tflite")


def bucket_count(n: int) -> str:
    if n <= 0:
        return "0"
    if n == 1:
        return "1"
    return "2+"


def detect_face_count(detector, image_path: str, min_confidence: float):
    image = cv2.imread(image_path)
    if image is None:
        raise FileNotFoundError(f"Could not read image: {image_path}")
    rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
    result = detector.detect(mp_image)
    if not result.detections:
        return 0, []
    scores = [d.categories[0].score for d in result.detections if d.categories]
    confident = [s for s in scores if s >= min_confidence]
    return len(confident), scores


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--labels", default=os.path.join("data", "labels.csv"))
    parser.add_argument("--frames-dir", default=os.path.join("data", "frames"))
    parser.add_argument("--min-confidence", type=float, default=0.5)
    parser.add_argument("--output", default=os.path.join("reports", "face-count-eval-results.json"))
    parser.add_argument("--model", default=DEFAULT_MODEL_PATH)
    args = parser.parse_args()

    if not os.path.exists(args.model):
        raise FileNotFoundError(
            f"Model file not found at {args.model}. Run `python download_model.py` first."
        )

    df = pd.read_csv(args.labels)
    base_options = BaseOptions(model_asset_path=os.path.abspath(args.model))
    options = vision.FaceDetectorOptions(
        base_options=base_options, min_detection_confidence=args.min_confidence
    )

    predictions = []
    with vision.FaceDetector.create_from_options(options) as detector:
        for _, row in df.iterrows():
            image_path = os.path.join(args.frames_dir, row["filename"])
            pred_count, scores = detect_face_count(detector, image_path, args.min_confidence)
            predictions.append({
                "frame_id": row["frame_id"],
                "filename": row["filename"],
                "ground_truth_face_count": int(row["ground_truth_face_count"]),
                "predicted_face_count": pred_count,
                "scores": scores,
                "condition_tags": row["condition_tags"],
            })

    results_df = pd.DataFrame(predictions)
    results_df["gt_bucket"] = results_df["ground_truth_face_count"].apply(bucket_count)
    results_df["pred_bucket"] = results_df["predicted_face_count"].apply(bucket_count)

    # Confusion matrix over the 3 buckets
    cm = confusion_matrix(results_df["gt_bucket"], results_df["pred_bucket"], labels=BUCKETS)

    # Binary precision/recall/F1 for NO_FACE (bucket "0") and MULTIPLE_FACES (bucket "2+")
    def binary_metrics(target_bucket: str):
        y_true = (results_df["gt_bucket"] == target_bucket).astype(int)
        y_pred = (results_df["pred_bucket"] == target_bucket).astype(int)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_true, y_pred, average="binary", zero_division=0
        )
        return {"precision": precision, "recall": recall, "f1": f1}

    no_face_metrics = binary_metrics("0")
    multiple_faces_metrics = binary_metrics("2+")

    # Per-condition-tag breakdown (a frame can have multiple |-separated tags)
    by_condition = defaultdict(lambda: {"total": 0, "correct": 0})
    for _, row in results_df.iterrows():
        correct = row["gt_bucket"] == row["pred_bucket"]
        for tag in str(row["condition_tags"]).split("|"):
            by_condition[tag]["total"] += 1
            if correct:
                by_condition[tag]["correct"] += 1
    condition_breakdown = {
        tag: {
            "total": v["total"],
            "correct": v["correct"],
            "accuracy": v["correct"] / v["total"] if v["total"] else None,
        }
        for tag, v in sorted(by_condition.items())
    }

    output = {
        "dataset_size": len(results_df),
        "min_confidence": args.min_confidence,
        "no_face_metrics": no_face_metrics,
        "multiple_faces_metrics": multiple_faces_metrics,
        "confusion_matrix": {
            "labels": BUCKETS,
            "matrix": cm.tolist(),
        },
        "condition_breakdown": condition_breakdown,
        "per_frame": predictions,
    }

    os.makedirs(os.path.dirname(args.output), exist_ok=True)
    with open(args.output, "w") as f:
        json.dump(output, f, indent=2, default=str)

    print(f"Evaluated {len(results_df)} frames\n")
    print("NO_FACE metrics:", no_face_metrics)
    print("MULTIPLE_FACES metrics:", multiple_faces_metrics)
    print(f"\nConfusion matrix (rows=ground truth, cols=predicted), labels={BUCKETS}:")
    print(cm)
    print("\nBy condition tag:")
    for tag, stats in condition_breakdown.items():
        print(f"  {tag}: {stats['correct']}/{stats['total']} correct")
    print(f"\nWrote {args.output}")


if __name__ == "__main__":
    main()
