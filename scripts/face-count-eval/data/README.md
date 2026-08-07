# Labeled test set (#1222)

## Format

`labels.csv` columns:

| column | meaning |
|---|---|
| `frame_id` | unique id for the frame (e.g. `seed_001`) |
| `filename` | image filename inside `data/frames/` |
| `ground_truth_face_count` | true number of faces in the frame (integer) |
| `condition_tags` | `\|`-separated tags describing the frame's conditions |

Condition tag vocabulary (add more as needed, keep them consistent):

- `normal` - typical exam-taking position
- `good_lighting` / `poor_lighting`
- `empty_desk` - user stepped away, 0 faces
- `two_people` - a peer or bystander is visible
- `mask` - face partially covered by a mask
- `side_angle` - face turned away from camera
- `partial_occlusion` - hand, hair, or object covering part of the face

`data/frames/*` is gitignored by default (except the tiny synthetic seed set
this project started with, since removed once real captures replaced it) -
real frames stay local-only until consent/retention is explicitly sorted out
for a given batch. See `REPORT.md` for the current dataset size and status.

## Adding real labeled frames

### Option A: interactive capture tool (recommended)

```bash
python data/capture_frames.py
```

Opens your webcam in a live preview window. Press `c` to capture the current
frame - you'll be prompted right in the terminal for the ground-truth face
count and condition tags, and both the image and the `labels.csv` row are
saved automatically (no manual filename/frame_id bookkeeping). Press `q` to
quit. Re-run it as many times as you like across different sessions/lighting/
angles - it picks up numbering where it left off.

**Consent**: only capture yourself, or others who have explicitly agreed to
be in this dataset. For a `two_people`/multi-face frame, get verbal
agreement from whoever else is in frame before pressing `c`.

Practical way to hit the condition variety in one or two sitting(s):
- **normal** (~40% of frames): just look at the camera normally, vary
  lighting a bit between captures (near a window vs. dim room)
  - **empty_desk / 0 faces** (~20%): step out of frame or turn the camera away, then capture
- **two_people** (~20%): have a friend/family member (who's agreed) join
  briefly for a batch of captures, then leave
- **edge cases** (~20%): put on a mask, turn to a side angle, cover part of
  your face with your hand (`partial_occlusion`), dim the lights
  (`poor_lighting`)

### Option B: import existing photos

```bash
python data/capture_frames.py --import path/to/photo.jpg
python data/capture_frames.py --import path/to/photos_folder/
```

Useful for photos captured elsewhere (e.g. a phone, then transferred over).
Each image is previewed - press any key to move to the same count/tags
prompts as live capture - and saved into the same numbering/labels.csv.

### Option C: fully manual

1. Capture frames from real exam sessions (with consent) or record your own
   test sessions covering the conditions above.
2. Save each frame as a `.jpg`/`.png` under `data/frames/`.
3. Add a row to `labels.csv` with the frame's real ground-truth face count
   (count it yourself by looking at the frame) and applicable condition tags.
4. Do **not** commit frames of real people without their consent. Keep bulk
   real-frame collections out of git if consent/retention isn't sorted out -
   `data/frames/*` is gitignored by default for exactly this reason; only
   reference them locally when running `eval.mjs`.

## Scaling to 200-300 frames

Aim for a rough spread across:
- ~40% normal single-face frames (varied lighting/angle)
- ~20% no-face frames (empty desk, user stepped away)
- ~20% multiple-face frames (peer/bystander present)
- ~20% edge cases (masks, occlusion, poor lighting, extreme angles)

Track progress by periodically running `node eval.mjs` and watching the
per-condition breakdown in the output - that's where you'll see which
conditions need more labeled examples.
