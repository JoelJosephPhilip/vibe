# Face-count detection offline evaluation (#1222)

Offline accuracy evaluation for the proctoring face-count detector (NO_FACE /
MULTIPLE_FACES flags). See `data/README.md` for the labeled test set format,
and `REPORT.md` for the current results and their status.

## Install

```bash
cd scripts/face-count-eval
npm install
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

## Runtime: this runs the actual production model

`eval.mjs` uses `@tensorflow-models/face-detection` (MediaPipeFaceDetector,
**tfjs runtime**, `modelType: "full"`, `maxFaces: 10`) via
`@tensorflow/tfjs-backend-wasm` - the exact same npm package, version, and
model config as `frontend/src/components/ai/FaceDetectorWorker.ts`, running
on the WASM CPU backend (the Node equivalent of the browser's CPU-fallback
path when WebGL is unavailable). This is true runtime parity: the eval
measures what the browser's model actually does, not a proxy for it.

(An earlier version of this harness used Python + MediaPipe's Tasks API
instead - a different wrapper around the same underlying model family, not
the actual production dependency. This version replaces that gap entirely.)

`@tensorflow/tfjs-node` would technically also work and run faster, but
needs a native addon - either a prebuilt binary for your Node version or a
local MSVC/Python build toolchain to compile one. Neither was available in
the environment this was built in, so WASM is the default. If you have a
working `tfjs-node` build, swapping the backend in `eval.mjs` (replace the
`tfjs-backend-wasm` import/`setBackend('wasm')` with
`require('@tensorflow/tfjs-node')`) should run faster without changing
results.

Per-face confidence: like the browser, this model's `Face` output has no
`score` field in the installed version (`1.0.3`, latest) - so this eval
cannot report per-face confidence either. That's a genuine model/library
limitation shared by both, not something specific to this eval script.
