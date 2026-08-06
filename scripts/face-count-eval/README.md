# Face-count detection offline evaluation (#1222)

Offline accuracy evaluation for the proctoring face-count detector (NO_FACE /
MULTIPLE_FACES flags). See `data/README.md` for the labeled test set format,
and `REPORT.md` for the current results and their status.

## Install

```bash
cd scripts/face-count-eval
python -m venv .venv
source .venv/bin/activate   # .venv\Scripts\activate on Windows
pip install -r requirements.txt
```

## Run

```bash
python download_model.py   # one-time: fetches the .tflite model file (not committed)
python eval.py
```

Optional flags:

```bash
python eval.py --labels data/labels.csv --frames-dir data/frames \
                --min-confidence 0.5 --output reports/face-count-eval-results.json
```

This prints a summary (precision/recall/F1 for NO_FACE and MULTIPLE_FACES, a
0/1/2+ confusion matrix, and a per-condition-tag breakdown) and writes the
full results to `reports/face-count-eval-results.json`.

## Regenerating the seed placeholder frames

The small seed set committed under `data/frames/` is synthetic (solid-color
images, no real people) so the harness runs out of the box. Regenerate it
with:

```bash
python data/make_seed_placeholders.py
```

## Runtime difference vs. the production frontend

The frontend proctoring detector runs `@tensorflow-models/face-detection`
(MediaPipeFaceDetector, **tfjs** runtime) in the browser. Its `Face` output
type has no confidence/score field at all (checked against the installed
`1.0.3`, the latest published version) - so the frontend cannot currently
report a real per-face confidence.

This eval script instead uses MediaPipe's **native Python** Face Detection
solution, which does expose `detection.score` per face. Both are the same
underlying MediaPipe face-detection model family, but different
wrappers/runtimes - face counts are expected to closely track each other
since it's the same model, but are not guaranteed bit-identical. This lets
the evaluation measure genuine confidence-weighted accuracy despite the
browser-side library's current limitation (tracked as a follow-up: adopting
a detector that surfaces confidence in the browser too).
