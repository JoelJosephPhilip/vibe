"""
Single-shot webcam capture, used interactively by Claude (#1222).

Captures exactly one frame right now and saves it to data/frames/real_NNN.jpg,
printing the path. Claude views the saved image and appends the labels.csv
row itself (count determined visually, tags from what the user says they're
testing) - this script does not append to labels.csv on its own.

Usage: python data/capture_one.py [--camera 0]
"""

import argparse
import csv
import os
import time

import cv2

FRAMES_DIR = os.path.join(os.path.dirname(__file__), "frames")
LABELS_PATH = os.path.join(os.path.dirname(__file__), "labels.csv")


def next_index():
    max_index = 0
    if os.path.exists(LABELS_PATH):
        with open(LABELS_PATH, newline="") as f:
            for row in csv.DictReader(f):
                filename = row.get("filename", "")
                if filename.startswith("real_"):
                    try:
                        n = int(os.path.splitext(filename)[0].split("_")[1])
                        max_index = max(max_index, n)
                    except (IndexError, ValueError):
                        pass
    return max_index + 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0)
    args = parser.parse_args()

    os.makedirs(FRAMES_DIR, exist_ok=True)

    # CAP_DSHOW avoids a common MSMF backend grab-frame failure on Windows.
    cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not cap.isOpened():
        raise RuntimeError(f"Could not open camera index {args.camera}.")

    # Warm-up: the sensor's auto-exposure/white-balance needs time to settle
    # after opening, especially with CAP_DSHOW - too few discarded frames
    # yields a solid black image.
    time.sleep(1.5)
    for _ in range(20):
        cap.read()
    ok, frame = cap.read()
    cap.release()

    if not ok:
        raise RuntimeError("Failed to read a frame from the camera.")

    index = next_index()
    filename = f"real_{index:03d}.jpg"
    path = os.path.join(FRAMES_DIR, filename)
    cv2.imwrite(path, frame)
    print(path)


if __name__ == "__main__":
    main()
