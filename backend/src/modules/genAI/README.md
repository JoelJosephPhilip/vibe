# GenAI Module — Video → Course Pipeline

> **Status as of 2026-09-01:** Both input paths (YouTube URL and uploaded video) work
> end-to-end for course/module/section/transcript/quiz generation. Two infrastructure
> gaps remain, both **outside this repo** — see [Known external gaps](#known-external-gaps).

This doc is a handoff/reference snapshot written after a long debugging session. It
covers the pipeline architecture, the two ways a job can start, every reliability fix
made to the transcript-conversion and question-generation paths (with root causes, so
the current tuning constants make sense to a future reader), and what's left open.

---

## Pipeline overview

```
AUDIO_EXTRACTION → TRANSCRIPT_GENERATION → SEGMENTATION → (course-plan preview/approval) → QUESTION_GENERATION → UPLOAD_CONTENT
```

- Orchestration: `services/GenAIService.ts` (huge — job lifecycle, task dispatch,
  course-plan preview, `uploadContent` which actually creates the Course/Module/
  Section/Item documents).
- `getJobState` walks `job.jobStatus.*` flags in order to compute `currentTask` — a
  stage is only dispatched if it isn't already `COMPLETED`.
- Real work happens either via `WebhookService` (the external AI server, reachable
  only from the real Cloud Run deployment over a private Tailscale network — see repo
  root `CLAUDE.md`) or via `_callAiServerOrFallback`'s **local fallback** services
  (`LocalAudioExtractionService`, `LocalTranscriptFormatService`,
  `LocalCoursePlanService`, `LocalQuestionGenerationService`) — what this fork's local
  dev/testing actually exercises.

## Two ways to start a job

### 1. YouTube URL (`JobBody.url`)
Default flow. `AUDIO_EXTRACTION` runs yt-dlp (`LocalAudioExtractionService`),
`TRANSCRIPT_GENERATION` runs whisper.cpp. **Currently blocked in this fork**: yt-dlp
needs YouTube cookies/bot-detection workarounds that aren't set up here.

Course/version/module are all optional — omit them and `uploadContent` auto-creates a
Course + CourseVersion (from the course-plan's proposed name) and a Module, via the
same `CourseService`/`ModuleService` a manual "Create Course" flow uses (see
`GenAIService.ts` ~1878-1990). No new course-creation code exists for this — it's the
real controller-equivalent service calls.

### 2. Uploaded video (`JobBody.videoAssetId`)
Teacher uploads an MP4 via `POST /media/video-assets/upload-url` (signed GCS PUT) →
`POST /media/video-assets/:assetId/uploaded`. **Requires an already-existing
course+version at upload time** — `VideoAssetService.createUploadUrl` calls
`assertCanManage`, a hard permission check against a real course (see
`backend/src/modules/media/README.md`). Frontend (`create-job.tsx`) can auto-create
that course on the spot via `useCreateCourse` right when a file is picked, so the
teacher never has to pre-create one by hand.

Uploaded video has **no auto-transcription path at all** (yt-dlp is YouTube-only) —
upload mode always requires a supplied transcript.

### The transcript bypass (works with either path)
Supplying `JobBody.transcript` at job creation marks `audioExtraction` and
`transcriptGeneration` `COMPLETED` immediately (`GenAIRepository.save`, driven purely
by `transcript` presence — never inspects `url` vs `videoAssetId`), skipping straight
to `SEGMENTATION`. **This means YouTube-URL mode can also skip yt-dlp** by supplying a
transcript — added to `create-job.tsx` specifically to route around the cookie
problem without needing the upload path's own GCS/transcoder dependency (see below).
A URL-sourced item's `videoDetails` is just `{URL: jobData.url, ...}` either way — no
GCS involvement regardless of whether the transcript was auto- or manually-supplied.

`frontend/src/app/pages/teacher/create-job.tsx`: mode toggle (URL / Upload), a shared
`TranscriptInputSection` (textarea + "Convert with MiniMax" button, optional in URL
mode, required in upload mode), `useVideoUpload`/`useCreateCourse` hooks for the
upload path.

---

## Known external gaps

Neither is fixable in this codebase.

1. **Uploaded-video playback never becomes ready on this fork's test bucket.**
   `backend/src/modules/media/README.md`'s own diagram: raw upload → **Cloud
   Function → Transcoder → HLS output** → the backend just *probes the stream bucket
   for a playlist* to decide `READY`. That Cloud Function + Transcoder pipeline is
   real GCP infrastructure "owned outside this repo," wired to the *original*
   production buckets. This fork's personal test bucket (`vibe-devd-6279-video-raw`,
   project `vibe-dev-d6279`, set up earlier to fix a CORS issue) has no such pipeline
   watching it, so uploads sit in `PROCESSING` forever and `playback-url` returns 400
   indefinitely. **Workaround in use: YouTube-URL mode + supplied transcript**
   (previous section) sidesteps this entirely, since URL-sourced items never touch
   GCS.

2. **The MiniMax API key hit its Token Plan usage limit.** Every transcript-conversion
   429 traced back to `{"message":"Token Plan usage limit reached: Upgrade your Token
   Plan or purchase Credits for more usage. (2056)"}` — a real billing/quota wall, not
   a rate limit that clears on its own on a useful timescale. No client-side pacing or
   backoff fixes this; it needs a plan upgrade, more credits, or a different API key
   on the MiniMax account. `MinimaxScreeningLlm.askJson` now surfaces the actual
   response body on 429/5xx (previously discarded) specifically so this was
   diagnosable at all — see `diag(screening): capture 429/5xx response body...`.

---

## MiniMax usage across this module

Four callers share `MinimaxScreeningLlm`
(`backend/src/modules/studentQuestions/services/screening/MinimaxScreeningLlm.ts`),
which itself reads endpoint/creds from `screeningConfig.minimax` and
timeout/retry-count from `screeningConfig.{timeoutMs,maxRetries}` (default 9000ms / 2
retries, both env-overridable via `SCREENING_TIMEOUT_MS`/`SCREENING_MAX_RETRIES` —
but that's a **global** knob shared by all four).

| Caller | Asks for | Notes |
|---|---|---|
| `screeningLlmFactory`/`ScreeningService` | one small flat verdict object | The actual crowd-question screening filter |
| `LocalCoursePlanService` | one `{name, description}` object per section/module | Course-plan preview naming |
| `LocalQuestionGenerationService` | one `{question, options[4], correctIndex}` object per question | See duplicate-question fix below |
| `LocalTranscriptFormatService` | a JSON **array** that grows with window content | The one caller with genuinely different latency needs |

`MinimaxScreeningLlm` takes an **optional constructor override**
(`{timeoutMs?, maxRetries?}`), fully backward-compatible — the other three callers
still construct it bare. Only `LocalTranscriptFormatService` uses it
(`{timeoutMs: 30000, maxRetries: 0}`), so its own outer retry loop is the only retry
layer for that service instead of compounding with `askJson`'s internal one.

---

## Transcript conversion (`LocalTranscriptFormatService.ts`) — reliability history

This was the most-iterated-on piece this session. Root causes, in the order they were
actually found (each seemed sufficient until the next real-world test disproved it):

1. **Windowing bug**: block-splitting originally searched for blank lines to avoid
   cutting a timestamped block mid-sentence, but the real format has none (single
   newlines only) — the fallback hard character-cut fired on every window. Fixed by
   splitting on actual timestamp-line boundaries (`TIMESTAMP_LINE` regex).
2. **Oversized single blocks**: a stretch of continuous speech before the next
   timestamp mark could still produce one block far bigger than `WINDOW_CHARS` on its
   own — the packer only ever combined whole blocks, never subdivided one. Fixed via
   `splitOversizedBlock` (word-boundary split, each piece re-prefixed with the
   original timestamp line).
3. **One bad window aborting the whole conversion**: originally any window's failure
   threw and discarded every already-converted window. Replaced with a two-pass
   design — a bounded main pass, then a more-patient recovery pass for anything still
   failed — but a user directive (**"I don't want any skipping"**) then reversed the
   original "skip and continue" fallback: if recovery *also* fails, the whole
   conversion now fails loudly, naming the specific portion, rather than silently
   omitting content. `skippedWindows` doesn't exist anywhere in the code/API/UI
   anymore.
4. **Concurrency was tried and ruled out**: dropped `WINDOW_CONCURRENCY` 8→3 on the
   theory that concurrent requests were overwhelming the provider — confirmed live
   this made **no difference** to the failure rate (13-15/67 windows either way), only
   slowed down how fast it failed. Left at 3 rather than restored, so later fixes
   could be evaluated in isolation.
5. **Timeout theory**: `WINDOW_TIMEOUT_MS = 30000` override added on the theory that
   9s was too tight for this service's variable-length output (real, but not the
   whole story — see below).
6. **The actual cause, confirmed via response-body logging**: real HTTP 429s from
   MiniMax, **"Token Plan usage limit reached"** — see
   [Known external gaps](#known-external-gaps) above. `MIN_REQUEST_INTERVAL_MS`
   pacing and 429-aware exponential backoff (`RATE_LIMIT_BASE_BACKOFF_MS` →
   `RATE_LIMIT_MAX_BACKOFF_MS`) were added and do help delay/spread out hitting the
   wall, but **cannot fix a real quota exhaustion** — that's an account-level issue.

**Verified working end-to-end** once the MiniMax key had headroom: a real 62-minute
podcast transcript (~586 chunks, ~hundreds of windows) converted successfully,
status 200, ~7-8 minutes wall-clock.

Current tuning (all in `LocalTranscriptFormatService.ts`, comments explain each):
`WINDOW_CHARS=1200`, `WINDOW_TIMEOUT_MS=30000`, `OUTER_ATTEMPTS=3` /
`OUTER_RETRY_DELAY_MS=5000`, `RECOVERY_ATTEMPTS=4` / `RECOVERY_RETRY_DELAY_MS=8000` /
`RECOVERY_CONCURRENCY=2`, `WINDOW_CONCURRENCY=3`, `MIN_REQUEST_INTERVAL_MS=4000`,
`RATE_LIMIT_BASE_BACKOFF_MS=15000` / `RATE_LIMIT_MAX_BACKOFF_MS=60000`.

The frontend (`create-job.tsx`) also lets a teacher **skip the AI call entirely** if
the pasted text is already valid `{chunks:[...]}` JSON
(`tryParseAlreadyFormattedTranscript`) — no tokens spent, no wait.

---

## Course-plan preview (`ai-gen-components/course-structure-preview.tsx`)

The "Approve & Generate Course" step, backed by `GenAIService.getCoursePlan` /
`updateCoursePlan`. Recently added:

- **Delete section**: no "exclude this time range" concept exists in the data model
  (`segmentMap` always tiles the full video, no gaps), so deleting folds the section
  into an adjacent one (next, or previous if it's the last section) — reuses the
  existing merge mechanism (`editSegmentMap`) under clearer intent.
- **Regenerate (per-section) / Regenerate entire structure**: new endpoints
  `POST .../course-plan/regenerate` and `POST .../course-plan/sections/regenerate`
  needed **zero new AI-calling code** — `getCoursePlan` already regenerates any
  section (or module/course name) it finds missing from `job.coursePlan`. The new
  service methods just clear the relevant cached entry/entries; the existing
  missing-entry-fill logic does the rest on the next fetch. Segment time boundaries
  are untouched by either.
- **Video preview pause bug**: a plain `<iframe src="...&end=...">`'s `end` param is
  unreliable on its own (confirmed live — playback just continued past it). Replaced
  with a real `YT.Player` (`SegmentPreviewPlayer`, via the existing
  `lib/youtube.ts:loadYouTubeIframeApi()` loader) that polls `getCurrentTime()` and
  calls `pauseVideo()` once actually reaching the segment's end.

---

## Question generation duplicate-question bug

**Symptom**: a section's quiz asked near-identical questions 2-3 times, minor wording
differences only.

**Root cause**: `GenAIService` requests `SOL = questionsPerQuiz × segmentCount` total
questions (`GenAIService.ts` ~1516-1520). When every segment has transcript text, that
means `LocalQuestionGenerationService.generateItems`'s per-segment count equals
`questionsPerQuiz` exactly — the *same* `segment.text` was sent to the *same*
`QUESTION_PROMPT` that many times in a row, to a provider called at `temperature: 0`
(hardcoded in `MinimaxScreeningLlm`, shared by all four callers). Deterministic
sampling + an unvarying prompt = near-identical output every time.

**Fix**: track each segment's already-generated question texts and tell the LLM to
write about a different fact/step/idea instead of repeating them
(`avoidQuestions` param threaded through `QUESTION_PROMPT` →
`generateOneQuestion` → `generateItems`'s inner loop). Not yet re-verified live with a
full course generation as of this doc's writing — worth confirming next.

---

## Quick reference

- Backend Render service: `srv-da6lba8u01pc738guk20` · Frontend: `srv-da7u5jlg1s2s73fe48sg`
  · Workspace: `tea-da6l7p8u01pc738gjqig`
- Test course used throughout this session ("Penguins at the Zoo (Full Fix
  Verification)"): courseId `6a90338f982bce34fd28f746`, versionId
  `6a90338f982bce34fd28f747`
- Personal GCS test bucket (upload path, playback still broken — see gaps above):
  `vibe-devd-6279-video-raw`, project `vibe-dev-d6279`
- Typecheck: `docker build -f backend/Dockerfile --target builder backend` (repo-root
  `CLAUDE.md` explains why this, not local `pnpm install`, is the reliable path on
  this dev machine)
- All work this session was fork-only (`origin/main`), per repo convention — nothing
  sent upstream

## Open items if resuming

- Question-generation duplicate fix (`991ef43e9`) needs a live re-test with a full
  course generation to confirm it actually produces varied questions per section.
- No fix exists yet for the two external-infra gaps; YouTube-URL + manual transcript
  is the working path until either is addressed outside this repo.
- If MiniMax quota is restored/upgraded, worth re-testing whether
  `WINDOW_CONCURRENCY` can go back up from 3 toward 8 for speed — it was left low
  deliberately for isolation, not because it was proven harmful.
