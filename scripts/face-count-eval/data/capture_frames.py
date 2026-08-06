"""
Interactive webcam capture tool for building the real labeled dataset (#1222).

Opens your webcam, shows a live preview. Press 'c' to capture the current
frame - you'll then be prompted in the terminal for the ground-truth face
count and condition tags, and the frame + labels.csv row are saved
automatically. Press 'q' to quit.

CONSENT: only capture frames of people who have explicitly agreed to be in
this dataset. For multi-face frames, get verbal agreement from whoever else
is in frame before pressing 'c'.

Usage:
    python data/capture_frames.py [--camera 0]
"""

import argparse
import csv
import os

import cv2

FRAMES_DIR = os.path.join(os.path.dirname(__file__), "frames")
LABELS_PATH = os.path.join(os.path.dirname(__file__), "labels.csv")

CONDITION_TAG_HINTS = (
    "normal, good_lighting, poor_lighting, empty_desk, two_people, mask, "
    "side_angle, partial_occlusion"
)


def next_index():
    """Find the next free real_NNN index by scanning existing labels.csv rows."""
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


def prompt_int(prompt_text: str) -> int:
    while True:
        raw = input(prompt_text).strip()
        try:
            return int(raw)
        except ValueError:
            print("Please enter a whole number.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default 0)")
    args = parser.parse_args()

    os.makedirs(FRAMES_DIR, exist_ok=True)
    labels_exists = os.path.exists(LABELS_PATH)

    # CAP_DSHOW avoids a common MSMF backend grab-frame failure on Windows.
    cap = cv2.VideoCapture(args.camera, cv2.CAP_DSHOW)
    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open camera index {args.camera}. Try a different --camera value, "
            "or check that no other app is using the webcam."
        )

    index = next_index()
    captured_this_session = 0
    print("Live preview open. Press 'c' to capture a frame, 'q' to quit.")
    print(f"Condition tag ideas: {CONDITION_TAG_HINTS}")

    with open(LABELS_PATH, "a", newline="") as f:
        writer = csv.writer(f)
        if not labels_exists:
            writer.writerow(["frame_id", "filename", "ground_truth_face_count", "condition_tags"])

        while True:
            ok, frame = cap.read()
            if not ok:
                print("Failed to read from camera.")
                break

            preview = frame.copy()
            cv2.putText(preview, "c = capture, q = quit", (10, 30),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.8, (0, 255, 0), 2)
            cv2.imshow("Face-count dataset capture", preview)

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                break
            if key == ord("c"):
                filename = f"real_{index:03d}.jpg"
                path = os.path.join(FRAMES_DIR, filename)
                cv2.imwrite(path, frame)

                print(f"\nCaptured {filename}.")
                count = prompt_int("  Ground-truth face count in this frame: ")
                tags = input(f"  Condition tags, '|'-separated (e.g. {CONDITION_TAG_HINTS.split(', ')[0]}): ").strip()

                writer.writerow([f"real_{index:03d}", filename, count, tags])
                f.flush()
                print(f"  Saved to labels.csv (frame_id=real_{index:03d}).\n")

                index += 1
                captured_this_session += 1

    cap.release()
    cv2.destroyAllWindows()
    print(f"\nCaptured {captured_this_session} frame(s) this session. Total dataset size: {index - 1}.")


if __name__ == "__main__":
    main()
