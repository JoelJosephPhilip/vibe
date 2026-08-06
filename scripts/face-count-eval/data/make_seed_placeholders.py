"""
Generates the tiny synthetic seed set committed to this repo so the eval
harness is runnable out of the box, with no real photos involved.

These are solid-color placeholder images, NOT real people. They only exercise
the pipeline mechanics (CSV loading, per-frame inference, metric computation),
not real detection accuracy. See data/README.md for how to replace them with
a real 200-300 frame labeled set.

Usage: python make_seed_placeholders.py
"""

import csv
import os

import numpy as np
import cv2

FRAMES_DIR = os.path.join(os.path.dirname(__file__), "frames")
LABELS_PATH = os.path.join(os.path.dirname(__file__), "labels.csv")

# (filename, ground_truth_face_count, condition_tags, color_bgr)
# 0-face rows are genuine: a solid-color image has no face in it, so
# ground_truth=0 is actually correct, not a placeholder fiction.
# 1-face/2+-face rows are schema placeholders ONLY (no real face is present),
# clearly tagged `placeholder_no_real_face` — expect the detector to report 0
# faces on these and the eval script to count them as false negatives. That is
# expected and documented, not a real accuracy signal. Replace with real
# frames before treating results as meaningful (see REPORT.md).
SEED_ROWS = [
    ("empty_desk_01.png", 0, "empty_desk|good_lighting", (40, 40, 40)),
    ("empty_desk_02.png", 0, "empty_desk|poor_lighting", (10, 10, 10)),
    ("empty_desk_03.png", 0, "empty_desk|good_lighting", (200, 200, 200)),
    ("blank_wall_01.png", 0, "normal|good_lighting", (120, 90, 60)),
    ("blank_wall_02.png", 0, "normal|side_angle", (60, 120, 90)),
    ("one_face_placeholder_01.png", 1, "normal|good_lighting|placeholder_no_real_face", (90, 60, 120)),
    ("one_face_placeholder_02.png", 1, "mask|placeholder_no_real_face", (60, 90, 120)),
    ("one_face_placeholder_03.png", 1, "side_angle|placeholder_no_real_face", (120, 60, 90)),
    ("two_people_placeholder_01.png", 2, "two_people|placeholder_no_real_face", (90, 120, 60)),
    ("two_people_placeholder_02.png", 2, "two_people|poor_lighting|placeholder_no_real_face", (30, 60, 30)),
    ("partial_occlusion_placeholder_01.png", 1, "partial_occlusion|placeholder_no_real_face", (150, 100, 50)),
    ("poor_lighting_placeholder_01.png", 1, "poor_lighting|placeholder_no_real_face", (15, 15, 15)),
]


def main():
    os.makedirs(FRAMES_DIR, exist_ok=True)
    with open(LABELS_PATH, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["frame_id", "filename", "ground_truth_face_count", "condition_tags"])
        for i, (filename, count, tags, color) in enumerate(SEED_ROWS, start=1):
            img = np.zeros((240, 320, 3), dtype=np.uint8)
            img[:] = color
            cv2.imwrite(os.path.join(FRAMES_DIR, filename), img)
            writer.writerow([f"seed_{i:03d}", filename, count, tags])
    print(f"Wrote {len(SEED_ROWS)} seed frames to {FRAMES_DIR}")
    print(f"Wrote {LABELS_PATH}")


if __name__ == "__main__":
    main()
