"""
Interactive tool for building the real labeled dataset (#1222).

Two modes:

1. Webcam capture (default): opens a live preview. Press 'c' to capture the
   current frame - you'll then be prompted in the terminal for the
   ground-truth face count and condition tags, and the frame + labels.csv
   row are saved automatically. Press 'q' to quit.

2. Import existing photos: --import points at a single image file or a
   directory of images (e.g. photos transferred from your phone). Each one
   is shown in a preview window and you're prompted the same way as capture
   mode - press any key in the preview window to proceed to the prompts.

CONSENT: only include frames of people who have explicitly agreed to be in
this dataset. For multi-face frames, get verbal agreement from whoever else
is in frame before capturing/importing.

Usage:
    python data/capture_frames.py [--camera 0]
    python data/capture_frames.py --import path/to/photo.jpg
    python data/capture_frames.py --import path/to/photos_folder/
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

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".bmp", ".webp")


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


def label_and_save(writer, f, index: int, image, ext: str = ".jpg") -> int:
    """Save `image` as the next real_NNN frame, prompt for its label, write
    the labels.csv row. Returns the next free index."""
    filename = f"real_{index:03d}{ext}"
    path = os.path.join(FRAMES_DIR, filename)
    cv2.imwrite(path, image)

    print(f"\nSaved {filename}.")
    count = prompt_int("  Ground-truth face count in this frame: ")
    tags = input(f"  Condition tags, '|'-separated (e.g. {CONDITION_TAG_HINTS.split(', ')[0]}): ").strip()

    writer.writerow([f"real_{index:03d}", filename, count, tags])
    f.flush()
    print(f"  Saved to labels.csv (frame_id=real_{index:03d}).\n")

    return index + 1


def run_import(path: str, writer, f, index: int) -> int:
    if os.path.isdir(path):
        files = sorted(
            os.path.join(path, name)
            for name in os.listdir(path)
            if name.lower().endswith(IMAGE_EXTENSIONS)
        )
        if not files:
            print(f"No image files found in {path}")
            return index
        print(f"Found {len(files)} image(s) in {path}.")
    else:
        files = [path]

    for file_path in files:
        image = cv2.imread(file_path)
        if image is None:
            print(f"Skipping {file_path} - could not read as an image.")
            continue

        print(f"\n{file_path}")
        cv2.imshow("Face-count dataset import - press any key to label", image)
        cv2.waitKey(0)
        cv2.destroyWindow("Face-count dataset import - press any key to label")

        ext = os.path.splitext(file_path)[1].lower() or ".jpg"
        index = label_and_save(writer, f, index, image, ext)

    return index


def run_webcam(camera_index: int, writer, f, index: int) -> int:
    # CAP_DSHOW avoids a common MSMF backend grab-frame failure on Windows.
    cap = cv2.VideoCapture(camera_index, cv2.CAP_DSHOW)
    if not cap.isOpened():
        raise RuntimeError(
            f"Could not open camera index {camera_index}. Try a different --camera value, "
            "or check that no other app is using the webcam."
        )

    print("Live preview open. Press 'c' to capture a frame, 'q' to quit.")
    print(f"Condition tag ideas: {CONDITION_TAG_HINTS}")

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
            index = label_and_save(writer, f, index, frame)

    cap.release()
    return index


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--camera", type=int, default=0, help="Camera device index (default 0)")
    parser.add_argument("--import", dest="import_path", default=None,
                         help="Import an existing image file or a directory of images instead of using the webcam")
    args = parser.parse_args()

    os.makedirs(FRAMES_DIR, exist_ok=True)
    labels_exists = os.path.exists(LABELS_PATH)

    start_index = next_index()

    with open(LABELS_PATH, "a", newline="") as f:
        writer = csv.writer(f)
        if not labels_exists:
            writer.writerow(["frame_id", "filename", "ground_truth_face_count", "condition_tags"])

        if args.import_path:
            end_index = run_import(args.import_path, writer, f, start_index)
        else:
            end_index = run_webcam(args.camera, writer, f, start_index)

    cv2.destroyAllWindows()
    captured = end_index - start_index
    print(f"\nSaved {captured} frame(s) this session. Total dataset size: {end_index - 1}.")


if __name__ == "__main__":
    main()
