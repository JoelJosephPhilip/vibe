# Face-count detection accuracy report (#1222)

> **PRELIMINARY — N=8 real frames, single-face only.**
> These numbers are real (not placeholders), but the dataset only covers the
> "1 face, normal" case so far — no 0-face or 2+-face frames exist yet, so
> NO_FACE and MULTIPLE_FACES precision/recall cannot be measured yet. Do not
> cite this report as evidence of production accuracy until the dataset
> covers all three buckets per `data/README.md`.

## Method

- **Model**: the actual production config from
  `frontend/src/components/ai/FaceDetectorWorker.ts` —
  `@tensorflow-models/face-detection`, `SupportedModels.MediaPipeFaceDetector`,
  `runtime: "tfjs"`, `modelType: "full"`, `maxFaces: 10`.
- **Runtime**: `@tensorflow/tfjs-backend-wasm` (Node) — the same npm package
  and version as production, running on the WASM CPU backend (the Node
  equivalent of the browser's CPU-fallback path when WebGL is unavailable).
  This is true runtime parity, not a different detector standing in for the
  real one. (An earlier version of this report used Python + MediaPipe's
  Tasks API instead — a different wrapper around the same model family, not
  the actual production dependency. See git history if that comparison is
  useful; this version replaces it.)
- **Confidence**: like the browser, this model's `Face` output has no
  `score` field in the installed version (`1.0.3`, latest) — so, like
  production, this eval cannot report per-face confidence. That's a genuine
  shared library limitation, not an eval-script gap.

## Dataset composition (N=8)

All real frames, captured via `data/capture_frames.py` (own webcam, self
only, consented).

| ground_truth_face_count | count | condition_tags |
|---|---|---|
| 1 | 8 | `normal\|good_lighting` (6), `normal\|harsh_lighting` (2) |
| 0 | 0 | none yet |
| 2+ | 0 | none yet |

## Metrics (current run)

| Flag | Precision | Recall | F1 |
|---|---|---|---|
| NO_FACE | 0 | 0 | 0 |
| MULTIPLE_FACES | 0 | 0 | 0 |

Both are mechanically 0/0/0 because there are zero ground-truth `0`-face or
`2+`-face examples in the dataset yet (no true positives possible, and the
model correctly never predicted either bucket on these single-face frames —
see confusion matrix). This is a dataset-coverage gap, not a detector
failure signal.

Confusion matrix (rows = ground truth, cols = predicted; labels = `[0, 1, 2+]`):

```
         pred_0  pred_1  pred_2+
gt_0        0       0       0
gt_1        0       8       0
gt_2+       0       0       0
```

By condition tag:

| tag | correct / total |
|---|---|
| good_lighting | 6/6 |
| harsh_lighting | 2/2 |
| normal | 8/8 |

## Interpretation

The model correctly detected exactly 1 face in all 8 real single-face
frames, including 2 under harsher lighting — a good sign for the easy case,
but this dataset doesn't yet test anything the model might actually get
wrong. It has no empty-desk frames, no multi-person frames, and none of the
harder conditions (masks, side angles, occlusion) that are exactly where
face detectors typically struggle.

**No conclusion about real-world accuracy can be drawn from this run** — not
because the numbers are bad, but because the dataset hasn't tested the hard
cases yet.

### Context from independent work on the same issue

A colleague's independent evaluation of this same model
(`fix/face-detection-accuracy-eval-1222` on a separate fork, 426 real
frames from WIDER FACE + the MSU Online Exam Proctoring dataset) found
**NO_FACE precision of 0.06 on real exam-webcam footage** — i.e. roughly
94% of frames the model would flag as "no face" actually had a face present,
typically because the person was looking down, wearing a cap, or resting a
hand near their face. That result isn't reproduced here (different, not
fully open-licensed dataset — see below), but it's a concrete, credible
signal that the hard cases matter a lot, and this dataset should prioritize
similar conditions (looking down, hand near face, hat/cap, side angle)
once it moves past single "look straight at the camera" frames.

We're not redistributing that colleague's dataset here: it includes frames
extracted from the MSU OEP dataset (Kaggle license listed as "Unknown") and
crops from WIDER FACE (CC BY-NC-ND — the "No Derivatives" clause is a real
question mark for a redistributed curated subset). Citing their numeric
finding doesn't carry the same redistribution risk as committing their
frames would.

## False positive / false negative examples by condition

None yet — every prediction in this run was correct, but only because the
dataset hasn't included any case the model could plausibly get wrong yet.

## Threshold recommendations

Not applicable yet — no confidence signal is available from this model
(see Method), and the dataset doesn't yet include borderline cases where a
threshold would matter.

## Decision: is current accuracy acceptable for proctoring?

**Not yet determined — insufficient data.** 8 easy, single-face frames
can't answer this. Based on the colleague's independent finding above,
there's real reason to expect NO_FACE performs much worse than this
snapshot suggests once harder conditions are included — this needs to be
verified directly against our own dataset, not assumed from their numbers,
before any decision is made here.

## Gaps / next steps

1. **Add 0-face and 2+-face frames** — this is the single highest-priority
   gap; right now literally 0% of the dataset can test either flag.
2. **Prioritize the hard cases** the colleague's finding flagged: looking
   down, hand/object near face, hat or cap, side angle, poor lighting —
   these are exactly where NO_FACE false positives are expected to
   concentrate.
3. Expand to 200-300 frames per the composition guidance in `data/README.md`.
4. Re-run `node eval.mjs` and replace every number in this report with the
   real results; remove the PRELIMINARY banner only once all three buckets
   have meaningful coverage.
5. Once a browser-side detector that exposes real per-face confidence is
   identified (tracked separately from #1222's confidence-persistence
   plumbing, which ships the field but can't populate it with the current
   library), re-evaluate whether confidence-based filtering measurably
   improves precision.
