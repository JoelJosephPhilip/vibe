# Face-count detection offline evaluation (#1222)

Offline accuracy evaluation for the proctoring face-count detector (NO_FACE /
MULTIPLE_FACES flags). See `data/README.md` for the labeled test set format,
and `REPORT.md` for the current results and their status.

## Install

```bash
cd scripts/face-count-eval
npm install              # also downloads the .tflite model via postinstall
npx playwright install chromium   # one-time: downloads a headless Chromium
```

## Run

```bash
npm run eval
# or: node eval.mjs
```

Optional flags:

```bash
node eval.mjs --labels data/labels.csv --frames-dir data/frames \
              --output reports/face-count-eval-results.json
```

This prints a summary (precision/recall/F1 for NO_FACE and MULTIPLE_FACES, a
0/1/2+ confusion matrix, and a per-condition-tag breakdown) and writes the
full results to `reports/face-count-eval-results.json`.

## Building the dataset

The webcam capture tools (`data/capture_frames.py`, `data/capture_one.py`)
are Python/OpenCV - a completely separate concern from the eval engine
above, used only to build `data/frames/` + `data/labels.csv`. See
`data/README.md` for how to use them. You do not need Python to run the
eval itself, only to capture new frames.

## Runtime: this runs the actual production model, in a real browser

`eval.mjs` starts a local static file server, launches a real headless
Chromium via Playwright, and runs `@mediapipe/tasks-vision`'s `FaceDetector`
(see `harness.html`) with the exact same config as
`frontend/src/components/ai/FaceDetectorWorker.ts` - same npm package,
same pinned version, same options. This is genuine runtime parity: the eval
measures what the browser's model actually does, not an approximation of it.

**Why a real browser instead of plain Node:** `@mediapipe/tasks-vision`
requires a real DOM. Confirmed empirically - even with `jsdom` polyfilling
`document`, the detector's WASM initialization promise never resolves in
plain Node (hangs indefinitely rather than erroring). A real browser is the
only environment this library reliably works in, so that's what this eval
uses, via Playwright + headless Chromium.

(Two earlier versions of this harness tested different libraries: a Python +
MediaPipe Tasks API version, then a Node + `@tensorflow-models/face-detection`
+ `tfjs-backend-wasm` version. Both predate the browser's own detector swap
to `@mediapipe/tasks-vision` for real confidence scores (#1222) and were
therefore testing a library production no longer uses. This version closes
that gap.)

Per-face confidence: unlike the previous library, `@mediapipe/tasks-vision`
does expose a real per-detection confidence (`categories[0].score`) - see
the `scores` field in each `reports/face-count-eval-results.json` entry.
