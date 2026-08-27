# AI-previewed, user-approved course generation from a YouTube URL

## Context

The genAI pipeline currently produces, from one YouTube URL, a module with **multiple sections all named identically** ("GTM Engineering Interview") with generic descriptions, each with exactly 1 quiz question and a hardcoded 1000 max attempts — confirmed live on the user's real GTM Engineering course. Root cause: `uploadContent()` never creates sections at all; it requires a pre-existing `moduleId`/`sectionId` and loops over every detected video segment appending items into that *one* section, reusing a single caller-supplied name for every item. The repeated identical section names were created upstream, by hand, across the multiple job retries run while iterating on segmentation fixes this session (`lam` penalty, chunk windowing, TF-IDF cap) — there is no per-segment AI title/description generator anywhere in this pipeline today.

The user wants the opposite shape: give a YouTube URL, tell it how many quiz questions per section and how many attempts (both global), get a full **preview** of the planned course — auto-created module, auto-created sections (one per detected segment) each with an AI-generated name/description, quiz item counts, a thumbnail, and a seekable video preview of each segment's boundaries — all manually editable, including merging/splitting sections, before anything is actually written to the course. Only on explicit approval does real generation happen. This is deliberately to avoid the token/cleanup cost of generating a full course and then discovering it's wrong (the exact pain from this session's live-duplication incident).

## Two decisions that shape everything else

**A section is a segment; merge/split is segment-boundary editing.** `segmentMap` (`number[]`, each entry a segment's end-time in seconds — this existing convention, documented in this repo's `CLAUDE.md`, is not touched) already drives one video+quiz item pair per segment. If sections map 1:1 onto segments, "merge two sections" = delete one boundary, "split a section" = insert one boundary — exactly what the existing `PATCH /genai/jobs/:id/edit/segment-map` (`editSegmentMap`, `GenAIService.ts:631`) and `run-segmentation-section.tsx`'s `handleAddSeg`/`handleRemoveSeg` already do. No new section-grouping data structure, no new edit endpoint.

**The preview/approval gate sits after SEGMENTATION, before QUESTION_GENERATION** — not after question generation. Questions are keyed by segment end-time (`groupChunksBySegment` in `LocalQuestionGenerationService.ts`); gating after question-gen would orphan questions on every merge/split. Gating before it means: no new `TaskType`/`TaskStatus` needed (the existing `segmentation COMPLETED → questionGeneration WAITING` step is the gate), no change to `_callAiServerOrFallback`, and — the actual token-saving win the user asked for — the expensive LLM question-generation stage never runs on a structure the user was about to reject.

**The pipeline never auto-advances today** — every stage requires an explicit client call (`POST /:id/tasks/approve/start` then `/approve/continue`). `JobStatus.tsx` currently only polls and displays badges; it doesn't drive anything. Any new flow must add that driving logic.

## 1. Backend data model

`backend/src/modules/genAI/classes/transformers/GenAI.ts`: add

```ts
export interface CourseSectionPlan {
  segmentEnd: number;      // matches a segmentMap entry — keyed, not indexed, so edits survive merge/split
  name: string;
  description: string;
}
export interface CoursePlan {
  moduleName: string;
  moduleDescription: string;
  sections: CourseSectionPlan[];
}
```
Add `coursePlan?: CoursePlan` to the `GenAI` class so it persists via the existing partial-update path (`genAIRepository.update(jobId, { coursePlan }, session)`, same pattern already used at `GenAIService.ts:267`). `JobState`/`segmentMap`/`TaskData` are unchanged.

`backend/src/modules/genAI/classes/validators/GenAIValidators.ts`:
- Add `maxAttempts?: number` (`@IsOptional() @IsNumber() @Min(-1)`) to both `UploadParameters` classes (~:294, ~:391), matching `QuizDetailsPayloadValidator.maxAttempts` (`ItemValidators.ts:134-144`, where -1 = unlimited).
- **No new `questionsPerSection` field.** `questionsPerQuiz` (~:319) already exists and already flows through `createGenAIJob`; wire it to actually drive generation instead (see §3) rather than adding a second source of truth for the same number.
- New `EditCoursePlanBody`: optional `moduleName`/`moduleDescription`, plus `sections: {segmentEnd: number; name: string; description: string}[]`.

## 2. AI-generated section/module titles — new `LocalCoursePlanService.ts`

New file `backend/src/modules/genAI/services/LocalCoursePlanService.ts` (a sibling to `LocalSegmentationService`/`LocalQuestionGenerationService`, not an extension of either — segmentation only emits numbers, question-gen is DI-bound as the question fallback specifically). Reuses `MinimaxScreeningLlm` exactly as `LocalQuestionGenerationService.ts:66` does — no new npm/native dependency, so Render's buildpack is unaffected.

- Export `groupChunksBySegment` from `LocalQuestionGenerationService.ts` (currently a private method, ~:137) as a module-level function; import it here instead of duplicating the grouping logic.
- One LLM call per segment (`{name, description}` from its transcript text) — per-segment rather than batched, so one bad/truncated segment can't take out the whole plan (mirrors the existing per-question robustness pattern at `LocalQuestionGenerationService.ts:117`, `try/catch` + fallback to `Section N`/empty description). One more call over the resulting section names produces `{moduleName, moduleDescription}`.
- Register via `GENAI_TYPES.LocalCoursePlanService` in `types.ts`/the container, following `LocalSegmentationService`'s existing registration.

## 3. Threading the two global numbers

**`maxAttempts`**: replace the hardcoded `1000` literals at `GenAIService.ts:1804` (smart-bloom) and `:1931` (legacy) with `(jobState.parameters as UploadParameters).maxAttempts ?? 1000`.

**Questions per section**: in the `QUESTION_GENERATION` branch of `getJobState` (`GenAIService.ts:1195-1215`), right after `jobState.segmentMap` is populated, override the generation parameters:
```ts
const perQuiz = job.uploadParameters?.questionsPerQuiz;
if (perQuiz && jobState.segmentMap?.length) {
  jobState.parameters = { ...job.questionGenerationParameters, SOL: perQuiz * jobState.segmentMap.length };
}
```
`LocalQuestionGenerationService.generateItems` already computes `perSegment = ceil(requestedCount / segmentCount)` from `SOL` (~:98-107) — feeding it `perQuiz × segmentCount` yields exactly `perQuiz` per segment with no change to that file's math, and since `jobState.parameters` is what gets forwarded to the real AI server too, the real server gets the corrected count as well. The existing upload-time clamp (`questionsPerQuiz ?? 2` at `:1957`) stays and now agrees with what was actually generated.

## 4. `uploadContent()` — auto-create module and sections

Inject `ModuleService`/`SectionService` into `GenAIService` (same DI pattern as the existing `ItemService` injection). Both already return the whole `ICourseVersion` (confirmed by reading `ModuleService.ts:55-121` and `SectionService.ts:43-112`) — the new entity is the last non-deleted element — and **both refuse to create if the preceding module/section has no items** (`ModuleService.ts:64-107`, `SectionService.ts:64-79`). That forces an interleaved order: create section → create its items → create next section, which the existing per-segment loop already naturally gives.

At the top of `uploadContent`, branch on `job.coursePlan`: if absent, run today's code unchanged byte-for-byte (so `AISectionPage.tsx`/`AiWorkflow.tsx`'s existing pre-existing-section flow keeps working); if present, auto-create mode:
1. If `uploadParameters.moduleId` is absent, `moduleService.createModule(versionId, {name: coursePlan.moduleName, description: coursePlan.moduleDescription})`, then read the new module back as `version.modules.filter(m => !m.isDeleted).at(-1)`.
2. Inside the existing `for (const currentSegmentId of jobState.segmentMap)` loop, first thing each iteration: `sectionService.createSection(versionId, moduleId, {name, description})` from the plan entry with matching `segmentEnd` (fallback `Section N` if missing), read the new section back the same way.
3. Use that per-iteration `sectionId` at the video-item call (~:1605-1610), the smart-bloom quiz call (~:1819-1824), and the legacy quiz call (~:1946-1951), replacing the single shared `sectionId`.
4. Video item name/description come from the plan entry instead of the static `videoSegName`/`"Video content"` literals (~:1590-1596); quiz item name = `${planEntry.name} Quiz`.

Known sharp edge, surfaced not silently handled: if the target version's existing last module already ends in an empty section, `createModule` throws — catch and rethrow naming the offending module so the teacher can act.

## 5. New API surface

Two endpoints on `GenAIController.ts`/`GenAIService.ts` (same `@Authorized()` + `getGenAIAbility` guard block as sibling routes, e.g. `:380`). Merge/split needs no new endpoint — it reuses `editSegmentMap`.

- **`GET /genai/jobs/:id/course-plan`**: reads `segmentMap` + transcript (via the existing `fetchTranscriptChunks`), generates a plan entry via `LocalCoursePlanService` for any `segmentEnd` not already stored (self-healing after merge/split — only changed boundaries cost tokens, untouched ones keep prior/user-edited values), prunes entries whose `segmentEnd` no longer exists, generates `moduleName`/`moduleDescription` if not yet stored, persists the merged plan, and returns the full preview payload in one shot: `{moduleName, moduleDescription, videoUrl, questionsPerQuiz, maxAttempts, sections: [{segmentStart, segmentEnd, name, description, transcriptExcerpt}]}`.
- **`PATCH /genai/jobs/:id/course-plan`**: whole-plan overwrite from `EditCoursePlanBody`.

Approval itself needs no new endpoint/status — "Approve & Generate" is just the existing `approve/continue` then `approve/start` calls.

## 6. Frontend

**`frontend/src/lib/genai-api.ts`**: add `maxAttempts` to `createGenAIJob`'s params/body (beside `questionsPerQuiz`, ~:172-182); add `getCoursePlan(jobId)`/`updateCoursePlan(jobId, plan)` next to `editSegmentMap` (~:575), added to the `aiSectionAPI` bundle.

**`create-job.tsx` rewrite**: replace the hand-rolled `fetch` (~:33-50) with `createGenAIJob`. Fields: Course ID, Version ID, YouTube URL, **Questions per section** (number, default 3), **Attempts allowed** (number, `min="-1"`, default -1, "-1 = unlimited" hint copied from `quiz-settings-dialog.tsx:197-211`). Module ID becomes optional ("add to existing module" — omitted means auto-created).

**`JobStatus.tsx` becomes the driver**: keep polling/`STAGE_ORDER` badges; add a driver effect that auto-advances stages (`WAITING` → `postJobTask`; `COMPLETED` with next stage `PENDING` → `approveContinueTask`), guarded by a ref against double-firing, **except** it stops when `segmentation === COMPLETED && questionGeneration === PENDING` and renders the preview instead of advancing. Resumes after approval.

**New `ai-gen-components/course-structure-preview.tsx`** (consumed directly by `JobStatus.tsx`, not bolted onto `task-accordion.tsx` — that component is coupled to the separate `useCourseStore` per-section flow):
- Header: YouTube thumbnail (`https://img.youtube.com/vi/${getYouTubeId(job.url)}/hqdefault.jpg`, reusing `getYouTubeId` from `components/video.tsx:44` — zero backend work), editable module name/description, summary line ("1 module · N sections · N quizzes · Q questions each · A attempts").
- One card per section: editable name/description, `mm:ss–mm:ss` range, transcript excerpt, and a segmentation preview via plain `<iframe src="https://www.youtube.com/embed/{id}?start={start}&end={end}">` — no frame extraction, no player API needed for a boundary check.
- Per-card **Merge with next** / **Split** actions, both just calling `editSegmentMap` with the adjusted array then refetching `getCoursePlan` (backend regenerates only the affected entries). Reuse the edit-modal conventions from `run-segmentation-section.tsx:133-196`.
- Footer: **Save edits** (`updateCoursePlan`) and **Approve & Generate Course** (saves, then hands control back to the driver, which proceeds through QUESTION_GENERATION → existing question-review gate, reusing `run-question-section.tsx` unchanged → UPLOAD_CONTENT).

## Verification

1. `docker build -f backend/Dockerfile --target builder backend` (context `backend`) — the only working backend typecheck on this machine per `CLAUDE.md`.
2. New backend unit test beside `callAiServerOrFallback.test.ts`: `getCoursePlan` regenerates only entries whose `segmentEnd` is new after a segmentMap edit and preserves user-edited names on unchanged ones; `SOL` resolves to `questionsPerQuiz × segmentMap.length`. LLM stubbed. (Runs in CI/non-Alpine env, not the local Docker image — `mongodb-memory-server` has no Alpine build.)
3. Live end-to-end on Render: create a job from `/teacher/jobs/create` with a short real YouTube video, 3 questions/section, 2 attempts, no module ID. Confirm it auto-drives to the preview (thumbnail renders, every section has a distinct AI name/description, embeds seek correctly). Merge two sections, split another, hand-edit one title; reload and confirm merged/split sections got fresh AI names while the hand-edited one kept its edit. Approve. Confirm in the course builder: one new module, N sections matching the preview, each with one correctly-timed video item and one quiz item. Open a quiz as a student: question count and max-attempts match what was configured — the direct proof both hardcoded values are dead.

## Commit split

Conventional Commits, fork-only (branch off `origin/main`, push + merge on `origin`, no upstream PR):
1. `feat(genai): thread maxAttempts and questionsPerQuiz through generation and upload`
2. `feat(genai): add AI-generated course plan with per-segment titles`
3. `feat(genai): auto-create module and sections from the approved course plan`
4. `feat(teacher): add course structure preview and approval gate to the job flow`

## Explicitly skipped (reuse-first, avoid unrequested scope)
- A separate section-grouping data structure/endpoint — segment-boundary editing already is merge/split.
- A new pipeline stage or `TaskStatus` — the existing `segmentation COMPLETED → questionGeneration WAITING` transition is the gate.
- Video frame extraction/thumbnail generation — YouTube's own static thumbnail + iframe embed cover both asks for free.
